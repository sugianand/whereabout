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
import time
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

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
from whereabout_ml.zeroshot import Guess, ZeroShotGeolocator

VERSION = "atlas-v0-zeroshot"
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


def download_images(photos: Sequence[Photo], cache: Path, pause_s: float = 0.2) -> list[Path]:
    """Fetch each photo once into `cache`, politely (one at a time, with a descriptive UA)."""
    cache.mkdir(parents=True, exist_ok=True)
    paths = []
    for photo in photos:
        if not photo.image_url:
            raise ValueError(f"{photo.id} has no image_url")
        suffix = ".png" if photo.image_url.lower().endswith(".png") else ".jpg"
        path = cache / f"{photo.id}{suffix}"
        if not path.exists():
            req = urllib.request.Request(photo.image_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                path.write_bytes(resp.read())
            time.sleep(pause_s)
        paths.append(path)
    return paths


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


def guess_to_json(g: Guess) -> dict:
    """The shape web/src/lib/game/types.ts expects for an AtlasGuess (lng/lat, like GeoJSON)."""
    return {
        "lng": round(g.lon, 5),
        "lat": round(g.lat, 5),
        "confidence": round(g.confidence, 4),
        "guessedPlace": f"{g.city}, {g.country}",
        "topCountries": [{"country": c, "p": round(p, 4)} for c, p in g.top_countries],
        "clues": [{"label": c.label, "p": round(c.p, 4)} for c in g.clues],
    }


def pick_best(systems: Sequence[System]) -> System:
    """The playable system with the lowest median error; mean score breaks ties."""
    playable = [s for s in systems if s.guesses is not None and s.report is not None]
    if not playable:
        raise ValueError("no playable systems")
    return min(playable, key=lambda s: (s.report.median_km, -s.report.mean_score))


def build_outputs(photos: Sequence[Photo], systems: Sequence[System], now: str | None = None):
    """Atlas's guesses for the game, plus a JSON report and a Markdown results page."""
    now = now or datetime.now(UTC).replace(microsecond=0).isoformat()
    for s in systems:
        s.report = evaluate(s.predictions)
    best = pick_best(systems)
    assert best.guesses is not None and best.report is not None

    atlas = {
        "model": best.name,
        "version": VERSION,
        "generatedAt": now,
        "guesses": {p.id: guess_to_json(g) for p, g in zip(photos, best.guesses, strict=True)},
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

    table = markdown_table({s.name: s.report for s in systems if s.report})
    report = {
        "system": VERSION,
        "generatedAt": now,
        "dataset": "whereabout-curated (data/curation/photos.csv)",
        "n": len(photos),
        "playing_in_game": best.name,
        "systems": {s.name: s.report.as_dict() for s in systems if s.report},
        "best_vs_others": comparisons,
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
    lines += [
        "",
        "## Read these numbers carefully",
        "",
        f"- **Small test set.** {report['n']} photos, so intervals are wide.",
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
    args = ap.parse_args(argv)
    models = args.models or [("ViT-B-32", "laion2b_s34b_b79k")]

    from whereabout_ml.clip_encoder import ClipEncoder

    photos = load_catalog(args.catalog)
    gazetteer = Gazetteer.load(args.gazetteer)
    paths = download_images(photos, args.images)

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
    for name, pretrained in models:
        started = time.perf_counter()
        encoder = ClipEncoder(name, pretrained)
        locator = ZeroShotGeolocator(encoder, gazetteer)
        embeddings = encoder.encode_images(paths)
        full = [locator.predict(e) for e in embeddings]
        country_only = [locator.predict_country_only(e) for e in embeddings]
        seconds = time.perf_counter() - started
        print(f"{encoder.name}: {len(photos)} photos in {seconds:.0f}s")
        systems.append(
            System(f"{encoder.name}, country only", predictions_from_guesses(photos, country_only))
        )
        systems.append(
            System(
                f"{encoder.name}, country then city", predictions_from_guesses(photos, full), full
            )
        )

    atlas, report, markdown = build_outputs(photos, systems)
    args.atlas_out.write_text(json.dumps(atlas, indent=1, ensure_ascii=False) + "\n")
    args.results_dir.mkdir(parents=True, exist_ok=True)
    (args.results_dir / "atlas-v0.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    )
    (args.results_dir / "atlas-v0.md").write_text(markdown)
    print(markdown)


if __name__ == "__main__":
    main()
