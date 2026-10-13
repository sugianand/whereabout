"""Run Atlas v0 on the photo catalog: compare models, score baselines, ship the best.

This is the offline "cold path" from docs/architecture.md: the model runs once, here, and the
game bundles its answers (web/src/data/atlas.json), so no visit ever waits on a model.

    atlas-v0 --catalog data/curation/photos.csv --gazetteer data/geonames \\
             --images .cache/images --atlas-out web/src/data/atlas.json \\
             --results-dir eval/results \\
             --model ViT-B-32:laion2b_s34b_b79k --model ViT-L-14:openai

For every model it evaluates the full pipeline (country, then city) and an ablation that
stops at the country. Two baselines are scored on the same photos. The system with the lowest
median error is the one players meet in the game.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from whereabout_api.catalog import load_catalog
from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_eval.metrics import (
    Prediction,
    Report,
    evaluate,
    markdown_table,
    paired_median_delta_ci,
)
from whereabout_ml.baselines import constant_guesses, random_city_guesses
from whereabout_ml.gazetteer import Gazetteer
from whereabout_ml.saliency import (
    DEFAULT_GRID,
    SALIENCY_VERSION,
    Saliency,
    explain,
    summarise,
)
from whereabout_ml.zeroshot import Guess, ZeroShotGeolocator

VERSION = "atlas-v0-zeroshot"
# Countries each guess reports for the reveal's shortlist (the city step still searches 3).
REVEAL_TOP_COUNTRIES = 5
USER_AGENT = "WhereaboutBot/0.1 (https://github.com/sugianand/whereabout; research demo)"


@dataclass
class System:
    """One row of the results table: a name and its prediction for every photo."""

    name: str
    predictions: list[Prediction]
    guesses: list[Guess] | None = None  # set for systems that can play in the game
    report: Report | None = None

    @property
    def distances(self) -> list[float]:
        return [p.distance_km for p in self.predictions]


def fetch(url: str, *, attempts: int = 4, backoff_s: float = 2.0) -> bytes:
    """GET `url` with a descriptive User-Agent, retrying on throttling and server errors."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            last = err
            if err.code not in (429, 500, 502, 503, 504):
                raise
            retry_after = err.headers.get("Retry-After") if err.headers else None
            wait = float(retry_after) if retry_after and retry_after.isdigit() else 0.0
            time.sleep(max(wait, backoff_s * 2**attempt))
        except urllib.error.URLError as err:
            last = err
            time.sleep(backoff_s * 2**attempt)
    raise RuntimeError(f"gave up on {url} after {attempts} attempts: {last}")


def download_images(
    photos: Sequence[Photo], cache: Path, pause_s: float = 0.5
) -> tuple[list[Photo], list[Path], dict[str, str]]:
    """Fetch each photo once into `cache`, politely: one at a time, paced, with retries.

    A photo that still can't be fetched is skipped and reported rather than failing the run.
    Returns the photos that are available, their paths, and {photo id: reason} for the rest.
    """
    cache.mkdir(parents=True, exist_ok=True)
    kept: list[Photo] = []
    paths: list[Path] = []
    failed: dict[str, str] = {}
    for photo in photos:
        if not photo.image_url:
            failed[photo.id] = "no image_url"
            continue
        suffix = ".png" if photo.image_url.lower().endswith(".png") else ".jpg"
        path = cache / f"{photo.id}{suffix}"
        if not path.exists():
            try:
                path.write_bytes(fetch(photo.image_url))
            except Exception as err:  # noqa: BLE001 - reported per photo, not fatal
                failed[photo.id] = str(err)
                print(f"skipping {photo.id}: {err}", file=sys.stderr)
                continue
            time.sleep(pause_s)
        kept.append(photo)
        paths.append(path)
    return kept, paths, failed


def predictions_from_guesses(photos: Sequence[Photo], guesses: Sequence[Guess]) -> list[Prediction]:
    return [
        Prediction(p.id, LatLon(g.lat, g.lon), p.location, g.country, p.country)
        for p, g in zip(photos, guesses, strict=True)
    ]


def predictions_from_points(photos: Sequence[Photo], points) -> list[Prediction]:
    return [
        Prediction(p.id, at, p.location, country, p.country)
        for p, (at, country) in zip(photos, points, strict=True)
    ]


def guess_to_json(g: Guess, looked: Saliency | None = None) -> dict:
    """The shape web/src/lib/game/types.ts expects for an AtlasGuess (lng/lat, like GeoJSON)."""
    out = {
        "lng": round(g.lon, 5),
        "lat": round(g.lat, 5),
        "confidence": round(g.confidence, 4),
        "guessedPlace": f"{g.city}, {g.country}",
        "topCountries": [{"country": c, "p": round(p, 4)} for c, p in g.top_countries],
        "clues": [{"label": c.label, "p": round(c.p, 4)} for c in g.clues],
    }
    if looked is not None:
        out["looked"] = {
            "grid": looked.grid,
            "crop": list(looked.crop),
            "cells": list(looked.cells),
        }
    return out


def country_log_prob(encoder, locator: ZeroShotGeolocator, country: str):
    """A scorer for saliency: log p(`country`) for each image in a batch of pixels."""
    codes = [c.code for c in locator.gazetteer.countries]
    idx = codes.index(country)

    def score(batch):
        embeddings = encoder.encode_pixels(batch)
        return np.array([np.log(locator.country_probabilities(e)[idx]) for e in embeddings])

    return score


def saliency_cache_path(cache: Path, model: str, photo_id: str, grid: int) -> Path:
    safe = "".join(ch if ch.isalnum() else "_" for ch in model)
    return cache / safe / f"{photo_id}-g{grid}-v{SALIENCY_VERSION}.json"


def explain_photos(
    photos: Sequence[Photo],
    paths: Sequence[Path],
    guesses: Sequence[Guess],
    encoder,
    locator: ZeroShotGeolocator,
    cache: Path,
    grid: int = DEFAULT_GRID,
    seed: int = 0,
) -> dict[str, Saliency]:
    """Where Atlas looked, for every photo, cached by (model, photo, grid, guessed country).

    Occlusion costs ~50 forward passes per photo, so a cached map is reused until the photo's
    guess changes; only new or re-guessed photos cost anything on later runs.
    """
    out: dict[str, Saliency] = {}
    for photo, path, guess in zip(photos, paths, guesses, strict=True):
        file = saliency_cache_path(cache, encoder.name, photo.id, grid)
        if file.exists():
            cached = json.loads(file.read_text())
            if cached.get("country") == guess.country:
                out[photo.id] = Saliency(
                    cached["grid"],
                    tuple(cached["cells"]),
                    tuple(cached["crop"]),
                    cached["top_k_drop"],
                    cached["random_k_drop"],
                )
                continue
        pixels, crop = encoder.load_pixels(path)
        rng = np.random.default_rng([seed, int.from_bytes(photo.id.encode(), "little") % 2**32])
        s = explain(pixels, crop, country_log_prob(encoder, locator, guess.country), rng, grid)
        out[photo.id] = s
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(
            json.dumps(
                {
                    "country": guess.country,
                    "grid": s.grid,
                    "cells": s.cells,
                    "crop": s.crop,
                    "top_k_drop": s.top_k_drop,
                    "random_k_drop": s.random_k_drop,
                }
            )
        )
    return out


def pick_best(systems: Sequence[System]) -> System:
    """The playable system with the lowest median error; mean score breaks ties."""
    playable = [s for s in systems if s.guesses is not None and s.report is not None]
    if not playable:
        raise ValueError("no playable systems")
    return min(playable, key=lambda s: (s.report.median_km, -s.report.mean_score))


def build_outputs(
    photos: Sequence[Photo],
    systems: Sequence[System],
    now: str | None = None,
    skipped: dict[str, str] | None = None,
    saliency: dict[str, Saliency] | None = None,
):
    """Atlas's guesses for the game, plus a JSON report and a Markdown results page.

    `saliency` (photo id → where the playing system looked) is attached to its guesses.
    """
    saliency = saliency or {}
    now = now or datetime.now(UTC).replace(microsecond=0).isoformat()
    for s in systems:
        s.report = evaluate(s.predictions)
    best = pick_best(systems)
    assert best.guesses is not None and best.report is not None

    atlas = {
        "model": best.name,
        "version": VERSION,
        "generatedAt": now,
        "guesses": {
            p.id: guess_to_json(g, saliency.get(p.id))
            for p, g in zip(photos, best.guesses, strict=True)
        },
    }

    comparisons = []
    for s in systems:
        if s is best:
            continue
        delta, lo, hi = paired_median_delta_ci(best.distances, s.distances)
        comparisons.append(
            {
                "versus": s.name,
                "median_km_delta": round(delta, 1),
                "ci95": [round(lo, 1), round(hi, 1)],
            }
        )

    # The results table travels with the guesses, so the site's "How Atlas works" page shows
    # the numbers from the very run that produced the guesses players meet.
    atlas["evaluation"] = {
        "n": len(photos),
        "systems": [
            {"name": s.name, "playsInGame": s is best, **s.report.as_dict()}
            for s in systems
            if s.report
        ],
    }
    faithfulness = summarise(list(saliency.values())) if saliency else None
    if faithfulness:
        atlas["evaluation"]["saliency"] = faithfulness

    table = markdown_table({s.name: s.report for s in systems if s.report})
    report = {
        "system": VERSION,
        "generatedAt": now,
        "dataset": "whereabout-curated (data/curation/photos.csv)",
        "n": len(photos),
        "skipped": dict(skipped or {}),
        "playing_in_game": best.name,
        "systems": {s.name: s.report.as_dict() for s in systems if s.report},
        "best_vs_others": comparisons,
        "saliency": faithfulness,
        "table": table,
    }
    return atlas, report, results_markdown(report, now)


def results_markdown(report: dict, now: str) -> str:
    lines = [
        "# Atlas v0 results",
        "",
        f"Generated {now} by `.github/workflows/atlas.yml` on {report['n']} photos from "
        "`data/curation/photos.csv`. Every number below comes from that run; nothing is typed "
        "in by hand.",
        "",
        f"**Playing in the game:** {report['playing_in_game']} (lowest median error).",
        "",
        report["table"],
        "",
        "Accuracy columns are the share of photos guessed within that distance. Median error "
        "has a 95% bootstrap confidence interval. Mean score uses the game's scoring (5,000 "
        "for a perfect guess).",
        "",
        "## Is the winner really better?",
        "",
        "Paired bootstrap on the same photos: the winner's median error minus each other "
        "system's. An interval that excludes 0 is a real difference on photos like these.",
        "",
        "| Compared with | Median km difference | 95% CI |",
        "| --- | ---: | ---: |",
    ]
    for c in report["best_vs_others"]:
        lo, hi = c["ci95"]
        lines.append(f"| {c['versus']} | {c['median_km_delta']:,.0f} | {lo:,.0f} to {hi:,.0f} |")
    sal = report.get("saliency")
    if sal:
        lines += [
            "",
            "## Where Atlas looked: is the map faithful?",
            "",
            f"Occlusion saliency on a {sal['grid']}×{sal['grid']} grid over the square CLIP sees, "
            f"for {sal['n']} photos. Deletion test: hide the {sal['k']} cells the map ranks "
            f"highest, or {sal['k']} random cells, and measure the relative drop in Atlas's "
            "probability for the country it chose.",
            "",
            "| Cells hidden | Mean drop in p(country) |",
            "| --- | ---: |",
            f"| Top {sal['k']} by saliency | {sal['mean_top_k_drop']:.1%} |",
            f"| {sal['k']} random (mean of 3 draws) | {sal['mean_random_k_drop']:.1%} |",
            "",
            f"Hiding the top cells hurt more than hiding random ones on "
            f"{sal['share_top_worse']:.0%} of photos.",
        ]
    lines += [
        "",
        "## Read these numbers carefully",
        "",
        f"- **Small test set.** {report['n']} photos, so intervals are wide.",
        *(
            [
                f"- **Skipped.** {len(report['skipped'])} photos couldn't be downloaded: "
                + ", ".join(sorted(report["skipped"]))
                + "."
            ]
            if report["skipped"]
            else []
        ),
        "- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were "
        "pre-trained on large web scrapes that probably include Commons images or captions. "
        "Some photos may have been seen in training, which would flatter these scores. Public "
        "benchmarks (Im2GPS3k, YFCC4k) are the next step.",
        "- **The constant baseline is optimistic.** It is fitted on these same photos.",
        "- **No training happened.** This is zero-shot: the baseline every trained Atlas model "
        "has to beat.",
        "",
    ]
    return "\n".join(lines)


def parse_model(spec: str) -> tuple[str, str]:
    name, sep, pretrained = spec.partition(":")
    if not sep or not name or not pretrained:
        raise argparse.ArgumentTypeError(f"expected MODEL:PRETRAINED, got {spec!r}")
    return name, pretrained


def main(argv: Sequence[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--gazetteer", type=Path, required=True, help="dir with GeoNames files")
    ap.add_argument("--images", type=Path, required=True, help="image cache directory")
    ap.add_argument("--atlas-out", type=Path, required=True)
    ap.add_argument("--results-dir", type=Path, required=True)
    ap.add_argument(
        "--model",
        type=parse_model,
        action="append",
        dest="models",
        help="open_clip MODEL:PRETRAINED; repeat to compare several",
    )
    ap.add_argument(
        "--saliency-grid",
        type=int,
        default=DEFAULT_GRID,
        help="occlusion grid for 'where Atlas looked' (0 turns it off)",
    )
    ap.add_argument("--saliency-cache", type=Path, default=Path(".cache/saliency"))
    args = ap.parse_args(argv)
    models = args.models or [("ViT-B-32", "laion2b_s34b_b79k")]

    from whereabout_ml.clip_encoder import ClipEncoder

    gazetteer = Gazetteer.load(args.gazetteer)
    photos, paths, skipped = download_images(load_catalog(args.catalog), args.images)
    if not photos:
        raise SystemExit(f"no photos could be downloaded: {skipped}")

    systems: list[System] = [
        System(
            "Random city (baseline)",
            predictions_from_points(photos, random_city_guesses(photos, gazetteer)),
        ),
        System(
            "Best constant guess (baseline)",
            predictions_from_points(photos, constant_guesses(photos)),
        ),
    ]
    handles: dict[str, tuple[ClipEncoder, ZeroShotGeolocator]] = {}
    for name, pretrained in models:
        started = time.perf_counter()
        encoder = ClipEncoder(name, pretrained)
        locator = ZeroShotGeolocator(encoder, gazetteer, report_top_countries=REVEAL_TOP_COUNTRIES)
        embeddings = encoder.encode_images(paths)
        full = [locator.predict(e) for e in embeddings]
        country_only = [locator.predict_country_only(e) for e in embeddings]
        seconds = time.perf_counter() - started
        print(f"{encoder.name}: {len(photos)} photos in {seconds:.0f}s")
        handles[f"{encoder.name}, country then city"] = (encoder, locator)
        systems.append(
            System(f"{encoder.name}, country only", predictions_from_guesses(photos, country_only))
        )
        systems.append(
            System(
                f"{encoder.name}, country then city", predictions_from_guesses(photos, full), full
            )
        )

    saliency: dict[str, Saliency] = {}
    if args.saliency_grid > 0:
        for s in systems:
            s.report = evaluate(s.predictions)
        best = pick_best(systems)
        encoder, locator = handles[best.name]
        started = time.perf_counter()
        try:
            saliency = explain_photos(
                photos,
                paths,
                best.guesses,
                encoder,
                locator,
                args.saliency_cache,
                args.saliency_grid,
            )
            print(f"saliency: {len(saliency)} photos in {time.perf_counter() - started:.0f}s")
        except Exception as err:  # noqa: BLE001 - maps are a bonus; never lose the guesses
            saliency = {}
            print(f"saliency failed, shipping guesses without maps: {err!r}", file=sys.stderr)

    atlas, report, markdown = build_outputs(photos, systems, skipped=skipped, saliency=saliency)
    args.atlas_out.write_text(json.dumps(atlas, indent=1, ensure_ascii=False) + "\n")
    args.results_dir.mkdir(parents=True, exist_ok=True)
    (args.results_dir / "atlas-v0.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    )
    (args.results_dir / "atlas-v0.md").write_text(markdown)
    print(markdown)


if __name__ == "__main__":
    main()
