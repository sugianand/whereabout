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

With `--references`, the winner is also refined by retrieval over geotagged reference photos
(`whereabout_ml.retrieval`). The refined system is scored next to the others, and plays in the
game only if a paired bootstrap shows it beats the system it refines. With `--labels` and
`--reference-labels` too, clue heads (`whereabout_ml.clue_heads`) are fitted on the reference
photos' embeddings for the driving side and the climate group, scored against today's clues on
the game photos, and write the reveal's clue for a concept only where they are clearly better.
A geocell head (`whereabout_ml.geocell_head`) is fitted on the same reference photos and scored
alone and as the pin within Atlas's country; the latter plays only if it clearly beats the
playing system.

With `--pocket-model` too, the same reference photos are embedded by the browser's model and
refine Pocket Atlas's own zero-shot guesses, and (with the labels) clue heads are fitted on them
against Pocket Atlas's own clues; those paired verdicts are reported and written into
`pocket-calibration.json` for `pocket-atlas-index`, and never change the game.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
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
from whereabout_ml.belief import belief_from_probabilities
from whereabout_ml.calibration import calibrate, softmax_t, sureness_bands
from whereabout_ml.clue_heads import (
    CLIMATE_GROUP,
    CONCEPTS,
    DRIVING_SIDE,
    HeadResult,
    apply_heads,
    evaluate_head,
    export_probe,
    labels_for,
    load_labels,
    zero_shot_climate_groups,
)
from whereabout_ml.embedding_cache import cached_image_embeddings, safe_name
from whereabout_ml.gazetteer import Gazetteer
from whereabout_ml.geocell_head import run_head
from whereabout_ml.geocell_head import summary as geocell_summary
from whereabout_ml.labels import driving_side
from whereabout_ml.retrieval import (
    GamePhotoTrace,
    Reference,
    ReferenceIndex,
    leakage_filter,
    load_references,
    ships,
)
from whereabout_ml.retrieval import summary as retrieval_summary
from whereabout_ml.saliency import (
    DEFAULT_GRID,
    SALIENCY_VERSION,
    Saliency,
    explain,
    summarise,
)
from whereabout_ml.zeroshot import LOGIT_SCALE, Guess, ZeroShotGeolocator, normalise

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


def country_logits(locator: ZeroShotGeolocator, embeddings: Sequence[np.ndarray]) -> np.ndarray:
    """Photos × countries: the scaled similarities `country_probabilities` takes a softmax of."""
    images = normalise(np.asarray(embeddings, dtype=np.float64))
    return LOGIT_SCALE * images @ locator.country_embeddings.T


def calibrate_guesses(
    photos: Sequence[Photo],
    guesses: Sequence[Guess],
    embeddings: Sequence[np.ndarray],
    locator: ZeroShotGeolocator,
) -> tuple[list[Guess], dict[str, dict[str, float]], dict]:
    """Temperature-scale the playing system's country probabilities (`whereabout_ml.calibration`).

    Returns the guesses with calibrated `confidence` and shortlist probabilities (pins, cities
    and the shortlist's order are untouched: dividing logits by T never reorders countries), the
    belief heatmaps from the same probabilities, and the calibration record. When calibration
    does not lower held-out NLL the raw probabilities ship, so this returns them unchanged.
    """
    codes = [c.code for c in locator.gazetteer.countries]
    index = {c: i for i, c in enumerate(codes)}
    logits = country_logits(locator, embeddings)
    labels = [index.get(p.country or "", -1) for p in photos]
    temperatures, summary = calibrate(logits, labels, [p.location for p in photos])
    probs = softmax_t(logits, temperatures)
    out = []
    for g, p in zip(guesses, probs, strict=True):
        shortlist = tuple((c, float(p[index[c]])) for c, _ in g.top_countries)
        out.append(replace(g, confidence=shortlist[0][1], top_countries=shortlist))
    beliefs = {
        photo.id: belief_from_probabilities(codes, row)
        for photo, row in zip(photos, probs, strict=True)
    }
    return out, beliefs, summary


def pocket_calibration(
    photos: Sequence[Photo],
    embeddings: Sequence[np.ndarray],
    locator: ZeroShotGeolocator,
    model: str,
) -> dict:
    """Pocket Atlas's own temperature and reality-check bands (for `pocket-atlas-index`).

    Pocket Atlas runs one CLIP model in the browser, which need not be the one playing the game,
    so it gets its own temperature, fitted the same way as the game's (`calibrate`). The browser
    sees new photos, so it ships the temperature fitted on every catalog photo; the bands count
    the cross-fitted (held-out) probabilities, so "N of M photos" was never fitted on those
    photos. When calibration does not lower held-out NLL, T is 1 and the bands count raw ones.
    """
    codes = [c.code for c in locator.gazetteer.countries]
    index = {c: i for i, c in enumerate(codes)}
    logits = country_logits(locator, embeddings)
    labels = np.array([index.get(p.country or "", -1) for p in photos], dtype=np.int64)
    temperatures, summary = calibrate(logits, labels, [p.location for p in photos])
    probs = softmax_t(logits, temperatures)
    known = labels >= 0
    top = probs.argmax(axis=1)
    return {
        "model": model,
        "temperature": summary["temperature"] if summary["ships"] else 1.0,
        "fittedTemperature": summary["temperature"],
        "ships": summary["ships"],
        "n": summary["n"],
        "folds": summary["folds"],
        "blockDeg": summary["blockDeg"],
        "raw": {"nll": summary["raw"]["nll"], "ece": summary["raw"]["ece"]},
        "calibrated": {"nll": summary["calibrated"]["nll"], "ece": summary["calibrated"]["ece"]},
        "sureness": sureness_bands(
            [float(probs[i, top[i]]) for i in np.flatnonzero(known)],
            [bool(top[i] == labels[i]) for i in np.flatnonzero(known)],
        ),
    }


def guess_to_json(
    g: Guess, looked: Saliency | None = None, belief: dict[str, float] | None = None
) -> dict:
    """The shape web/src/lib/game/types.ts expects for an AtlasGuess (lng/lat, like GeoJSON)."""
    out = {
        "lng": round(g.lon, 5),
        "lat": round(g.lat, 5),
        "confidence": round(g.confidence, 4),
        "guessedPlace": f"{g.city}, {g.country}",
        "topCountries": [{"country": c, "p": round(p, 4)} for c, p in g.top_countries],
        "clues": [{"label": c.label, "p": round(c.p, 4)} for c in g.clues],
    }
    if belief:
        out["belief"] = belief
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
    return cache / safe_name(model) / f"{photo_id}-g{grid}-v{SALIENCY_VERSION}.json"


def explain_photos(
    photos: Sequence[Photo],
    paths: Sequence[Path],
    guesses: Sequence[Guess],
    encoder,
    locator: ZeroShotGeolocator,
    cache: Path,
    grid: int = DEFAULT_GRID,
    seed: int = 0,
    budget_s: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Saliency]:
    """Where Atlas looked, for every photo, cached by (model, photo, grid, guessed country).

    Occlusion costs ~50 forward passes per photo, so a cached map is reused until the photo's
    guess changes; only new or re-guessed photos cost anything on later runs.

    With `budget_s`, no new map is started once that many seconds have passed: photos past the
    budget are left out of the result (their guesses ship without a map) and get one on a later
    run, so a big catalog merge cannot push the run past the runner's time limit. Cached maps
    are always returned.
    """
    out: dict[str, Saliency] = {}
    started = clock()
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
        if budget_s is not None and clock() - started >= budget_s:
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


def refine_with_references(
    photos: Sequence[Photo],
    base: System,
    query_embeddings: Sequence[np.ndarray],
    index: ReferenceIndex,
    *,
    model: str,
    dropped: dict[str, int] | None = None,
) -> tuple[System, dict]:
    """`base`'s guesses refined by retrieval, as a system of its own, and the run's record.

    The refined system can play in the game (has guesses) only if `retrieval.ships` says it
    beats `base` on these photos; otherwise it is scored and reported, and the game keeps
    `base`.
    """
    if base.guesses is None:
        raise ValueError(f"{base.name} has no guesses to refine")
    refined = [index.refine(q, g) for q, g in zip(query_embeddings, base.guesses, strict=True)]
    guesses = [g for g, _ in refined]
    system = System(
        f"{base.name}, then nearest reference photos",
        predictions_from_guesses(photos, guesses),
        guesses,
    )
    verdict = ships(system.distances, base.distances)
    if not verdict.ships:
        system.guesses = None
    record = retrieval_summary(
        verdict,
        versus=base.name,
        references=len(index),
        countries=len({r.country for r in index.references}),
        moved=sum(moved for _, moved in refined),
        n=len(photos),
        dropped=dropped or {},
        model=model,
        k=index.k,
    )
    return system, record


def reembed_references(
    index: ReferenceIndex, images: Path, encoder, embedding_cache: Path
) -> ReferenceIndex:
    """The same reference photos (already past the leakage guard), embedded by `encoder`.

    Retrieval compares image with image, so a model can only search references embedded by
    itself: Pocket Atlas's ViT-B/32 cannot use the game's retrieval-model embeddings.
    """
    from whereabout_ml.reference_set import thumbnail_path

    refs = index.references
    embeddings, cached = cached_image_embeddings(
        encoder, [r.id for r in refs], [thumbnail_path(images, r.id) for r in refs], embedding_cache
    )
    print(
        f"references for {encoder.name}: {len(refs)} ({cached.encoded} encoded, "
        f"{cached.reused} from the embedding cache)"
    )
    return ReferenceIndex(
        refs,
        embeddings,
        k=index.k,
        temperature=index.temperature,
        min_references=index.min_references,
    )


def pocket_retrieval(
    photos: Sequence[Photo],
    base: System,
    embeddings: Sequence[np.ndarray],
    index: ReferenceIndex,
    *,
    model: str,
    dropped: dict[str, int] | None = None,
) -> tuple[System, dict]:
    """Would retrieval move Pocket Atlas's pins closer? Scored, never played in the game.

    `base` is Pocket Atlas's own zero-shot system (the browser model, country then city) and
    `index` the reference photos embedded by that model. The verdict is the same paired
    bootstrap as the game's refinement (`retrieval.ships`); the browser may turn retrieval on
    only when it says yes. The game is never changed by it, so the refined system is reported
    without guesses whatever the verdict, and the record keeps the verdict instead.
    """
    system, record = refine_with_references(
        photos, base, embeddings, index, model=model, dropped=dropped
    )
    system.name = f"{base.name}, then nearest reference photos (Pocket Atlas)"
    system.guesses = None
    return system, record


def _phash_or_none(path: Path) -> int | None:
    from whereabout_ml.ingest import phash_file

    try:
        return phash_file(path)
    except Exception as err:  # noqa: BLE001 - an unreadable image just skips the hash check
        print(f"could not hash {path.name}: {err}", file=sys.stderr)
        return None


def load_reference_index(
    references_csv: Path,
    images: Path,
    photos: Sequence[Photo],
    photo_paths: Sequence[Path],
    encoder,
    embedding_cache: Path,
    max_references: int | None = None,
) -> tuple[ReferenceIndex, dict[str, int]]:
    """The reference photos that have a readable thumbnail and pass the leakage guard,
    embedded. A thumbnail the image library cannot open is left out rather than failing the
    batch encode."""
    from whereabout_ml.reference_set import thumbnail_path

    refs: list[Reference] = []
    paths: list[Path] = []
    for r in load_references(references_csv):
        if max_references is not None and len(refs) >= max_references:
            break
        path = thumbnail_path(images, r.id)
        if path.exists():
            refs.append(r)
            paths.append(path)
    traces = [
        GamePhotoTrace(
            p.location.lat,
            p.location.lon,
            p.attribution or "",
            p.source_url or "",
            _phash_or_none(path),
        )
        for p, path in zip(photos, photo_paths, strict=True)
    ]
    hashes = [_phash_or_none(p) for p in paths]
    unreadable = sum(h is None for h in hashes)
    readable = [i for i, h in enumerate(hashes) if h is not None]
    refs, paths, hashes = (
        [refs[i] for i in readable],
        [paths[i] for i in readable],
        [hashes[i] for i in readable],
    )
    kept, dropped = leakage_filter(refs, hashes, traces)
    if unreadable:
        dropped["unreadable thumbnail"] = unreadable
    refs = [refs[i] for i in kept]
    paths = [paths[i] for i in kept]
    if not refs:
        return ReferenceIndex([], np.zeros((0, 1))), dict(dropped)
    embeddings, cached = cached_image_embeddings(
        encoder, [r.id for r in refs], paths, embedding_cache
    )
    print(
        f"references: {len(refs)} searchable ({cached.encoded} encoded, {cached.reused} from "
        f"the embedding cache); dropped by the leakage guard: {dict(dropped) or 'none'}"
    )
    return ReferenceIndex(refs, embeddings), dict(dropped)


def score_clue_heads(
    photos: Sequence[Photo],
    guesses: Sequence[Guess],
    playing_embeddings: Sequence[np.ndarray],
    locator: ZeroShotGeolocator,
    probe_embeddings: Sequence[np.ndarray],
    index: ReferenceIndex,
    game_labels: Path,
    reference_labels: Path,
) -> tuple[np.ndarray, list[HeadResult]]:
    """A probe for each concept on `index`'s reference embeddings, scored on the game photos
    against the clues `guesses` (made by `locator` from `playing_embeddings`) give today.

    The probes read `probe_embeddings`, which must be in the same space as the reference photos;
    they are returned unit-length, as the index's are, for `apply_heads`.
    """
    probe_embeddings = normalise(np.asarray(probe_embeddings, dtype=np.float64))
    game_table = load_labels(game_labels)
    ref_table = load_labels(reference_labels)
    ids = [p.id for p in photos]
    ref_ids = [r.id for r in index.references]
    ref_points = [LatLon(r.lat, r.lon) for r in index.references]
    game_points = [p.location for p in photos]
    baselines = {
        DRIVING_SIDE.name: [driving_side(g.country) for g in guesses],
        CLIMATE_GROUP.name: zero_shot_climate_groups(
            [locator.concept_probabilities(e)["climate"] for e in playing_embeddings]
        ),
    }
    results: list[HeadResult] = []
    for concept in CONCEPTS:
        result = evaluate_head(
            concept,
            index.embeddings,
            ref_points,
            labels_for(ref_ids, ref_table, concept.name),
            probe_embeddings,
            game_points,
            labels_for(ids, game_table, concept.name),
            baselines[concept.name],
        )
        if result is not None:
            results.append(result)
    return probe_embeddings, results


def fit_clue_heads(
    photos: Sequence[Photo],
    guesses: Sequence[Guess],
    playing_embeddings: Sequence[np.ndarray],
    locator: ZeroShotGeolocator,
    probe_embeddings: Sequence[np.ndarray],
    index: ReferenceIndex,
    game_labels: Path,
    reference_labels: Path,
    *,
    model: str,
) -> tuple[list[Guess], list[dict]]:
    """Clue heads for each concept, scored against today's clues; the guesses with the clues
    of every head that ships, and the records for atlas.json.

    The probes read `probe_embeddings` (the retrieval model's, the space the reference photos
    are embedded in); the zero-shot baseline is the playing system's own climate clue.
    """
    probe_embeddings, results = score_clue_heads(
        photos,
        guesses,
        playing_embeddings,
        locator,
        probe_embeddings,
        index,
        game_labels,
        reference_labels,
    )
    shipped = apply_heads(guesses, probe_embeddings, results)
    return shipped, [r.as_dict(model) for r in results]


def pocket_clue_heads(
    photos: Sequence[Photo],
    base: System,
    embeddings: Sequence[np.ndarray],
    locator: ZeroShotGeolocator,
    index: ReferenceIndex,
    game_labels: Path,
    reference_labels: Path,
    *,
    model: str,
) -> list[dict]:
    """Clue heads for Pocket Atlas, on the browser model's own embeddings. Never changes the game.

    `base` is Pocket Atlas's zero-shot system and `index` the reference photos embedded by the
    browser's model (`reembed_references`). Each probe is scored against what the browser shows
    today: its own zero-shot climate clue, and the driving side of the country it guessed. A
    record that ships carries the probe as an affine map (`export_probe`), which
    `pocket-atlas-index` puts in the index for the browser to run.
    """
    if base.guesses is None:
        raise ValueError(f"{base.name} has no guesses to compare clues with")
    _, results = score_clue_heads(
        photos, base.guesses, embeddings, locator, embeddings, index, game_labels, reference_labels
    )
    records = []
    for r in results:
        record = {**r.as_dict(model), "clue": r.concept.clue}
        if r.ships:
            record["probe"] = export_probe(r.probe)
        records.append(record)
    return records


def fit_geocell_head(
    photos: Sequence[Photo],
    base: System,
    query_embeddings: Sequence[np.ndarray],
    index: ReferenceIndex,
    *,
    model: str,
) -> tuple[list[System], dict] | None:
    """The geocell head scored alone and as `base`'s pin within its country, and the record.

    The in-country system can play (has guesses) only if it clearly beats `base`; the head
    alone never plays (its country would not match the shortlist and heatmap Atlas shows).
    None when there are too few reference photos to fit it.
    """
    if base.guesses is None:
        raise ValueError(f"{base.name} has no guesses to place")
    run = run_head(
        index.references,
        index.embeddings,
        np.asarray(query_embeddings, dtype=np.float64),
        base.guesses,
        base.distances,
        [p.location for p in photos],
    )
    if run is None:
        return None
    alone = System(
        f"{model} geocell head, alone",
        predictions_from_points(photos, [(pl.at, pl.country) for pl in run.alone]),
    )
    within = System(
        f"{base.name}, then geocell head",
        predictions_from_guesses(photos, run.within),
        run.within if run.verdict.ships else None,
    )
    return [alone, within], geocell_summary(run, versus=base.name, model=model, n=len(photos))


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
    beliefs: dict[str, dict[str, float]] | None = None,
    retrieval: dict | None = None,
    calibration: dict | None = None,
    clue_heads: list[dict] | None = None,
    geocell: dict | None = None,
    pocket_retrieval: dict | None = None,
    pocket_clue_heads: list[dict] | None = None,
):
    """Atlas's guesses for the game, plus a JSON report and a Markdown results page.

    `saliency` (photo id → where the playing system looked) and `beliefs` (photo id → country
    distribution, see `belief_from_probabilities`) are attached to its guesses. `retrieval` is
    the record from `refine_with_references`, if the run tried the refinement, and
    `calibration` the one from `calibrate_guesses`, `clue_heads` the records from
    `fit_clue_heads`, `geocell` the one from `fit_geocell_head`, `pocket_retrieval` the one
    from `pocket_retrieval` and `pocket_clue_heads` the records from `pocket_clue_heads`
    (both reported only: they decide the browser, not the game).
    """
    saliency = saliency or {}
    beliefs = beliefs or {}
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
            p.id: guess_to_json(g, saliency.get(p.id), beliefs.get(p.id))
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
    if retrieval:
        atlas["evaluation"]["retrieval"] = retrieval
    if calibration:
        atlas["evaluation"]["calibration"] = calibration
    if clue_heads:
        atlas["evaluation"]["clueHeads"] = clue_heads
    if geocell:
        atlas["evaluation"]["geocellHead"] = geocell
    if pocket_retrieval:
        atlas["evaluation"]["pocketRetrieval"] = pocket_retrieval
    # The site's results page shows the comparison; the probes' weights travel only in
    # pocket-calibration.json, to the browser's index.
    pocket_heads = [
        {k: v for k, v in h.items() if k != "probe"} for h in pocket_clue_heads or []
    ] or None
    if pocket_heads:
        atlas["evaluation"]["pocketClueHeads"] = pocket_heads

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
        "retrieval": retrieval,
        "calibration": calibration,
        "clue_heads": clue_heads,
        "geocell_head": geocell,
        "pocket_retrieval": pocket_retrieval,
        "pocket_clue_heads": pocket_heads,
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
    ret = report.get("retrieval")
    if ret:
        lo, hi = ret["ci95"]
        dropped = ", ".join(f"{n} {why}" for why, n in ret["dropped"].items()) or "none"
        lines += [
            "",
            "## Retrieval refinement: does it beat the system it refines?",
            "",
            f"{ret['versus']} refined by searching {ret['references']:,} geotagged reference "
            f"photos in {ret['countries']} countries (never game photos; image similarity from "
            f"{ret['model']}): within Atlas's chosen country, the pin moves to the weighted "
            f"medoid of the {ret['k']} most similar reference photos. It moved the pin on "
            f"{ret['moved']} of {ret['n']} photos; the others had too few reference photos in "
            "their country. References dropped by the leakage guard: " + dropped + ".",
            "",
            "| Refined minus unrefined | Median km difference | 95% CI | Plays in the game |",
            "| --- | ---: | ---: | --- |",
            f"| {ret['versus']} | {ret['median_km_delta']:,.0f} | {lo:,.0f} to {hi:,.0f} | "
            f"{'yes' if ret['ships'] else 'no'} |",
            "",
            "It plays only if the whole interval is below zero.",
        ]
    pret = report.get("pocket_retrieval")
    if pret:
        lo, hi = pret["ci95"]
        lines += [
            "",
            "## Pocket Atlas: would retrieval help the browser's model?",
            "",
            f'"Try Atlas on your photo" runs {pret["model"]} in the browser. The same reference '
            f"photos, embedded by that model, refine its own guesses ({pret['versus']}) as above: "
            f"the pin moves to the weighted medoid of the {pret['k']} most similar reference "
            f"photos within its chosen country. It moved the pin on {pret['moved']} of "
            f"{pret['n']} catalog photos.",
            "",
            "| Refined minus unrefined | Median km difference | 95% CI | Turns on in the browser |",
            "| --- | ---: | ---: | --- |",
            f"| {pret['versus']} | {pret['median_km_delta']:,.0f} | {lo:,.0f} to {hi:,.0f} | "
            f"{'yes' if pret['ships'] else 'no'} |",
            "",
            "It may turn on only if the whole interval is below zero. The game's own Atlas is "
            "never changed by this row.",
        ]
    geo = report.get("geocell_head")
    if geo:
        lo, hi = geo["ci95"]
        lines += [
            "",
            "## Geocell head: does a trained classifier place the pin better?",
            "",
            f"A linear classifier over {geo['cells']} adaptive geocells, on frozen "
            f"{geo['model']} image embeddings of {geo['references']:,} reference photos (never "
            "game photos), trained with haversine label smoothing "
            f"(τ = {geo['tauKm']:g} km, L2 = {geo['l2']:g}, both chosen by 10° geographic "
            "cross-validation over the reference photos alone). The pin is the candidate with "
            "the least expected distance under the head's cell probabilities. Scored alone (any "
            f"cell, in the table above) and within {geo['versus']}'s country, where it moved the "
            f"pin on {geo['moved']} of {geo['n']} photos.",
            "",
            "| Within the country, minus without | Median km difference | 95% CI | Plays in the "
            "game |",
            "| --- | ---: | ---: | --- |",
            f"| {geo['versus']} | {geo['median_km_delta']:,.0f} | {lo:,.0f} to {hi:,.0f} | "
            f"{'yes' if geo['ships'] else 'no'} |",
            "",
            "It plays only if the whole interval is below zero.",
        ]
    cal = report.get("calibration")
    if cal:
        raw, held = cal["raw"], cal["calibrated"]
        lines += [
            "",
            "## How sure is Atlas: calibration",
            "",
            f"Temperature scaling of the playing system's country probabilities, on the "
            f"{cal['n']} photos whose country the gazetteer knows. Each photo's temperature is "
            f"fitted on the other {cal['folds'] - 1} of {cal['folds']} folds, dealt by "
            f"{cal['blockDeg']:g}° geographic blocks, so every calibrated number below is "
            f"measured on photos its fit never saw. Fitted on all of them, T = "
            f"{cal['temperature']:.3f} (above 1 means the raw model was overconfident).",
            "",
            "| Probabilities | Negative log likelihood | Expected calibration error |",
            "| --- | ---: | ---: |",
            f"| Raw CLIP softmax | {raw['nll']:.3f} | {raw['ece']:.1%} |",
            f"| Temperature-scaled (held out) | {held['nll']:.3f} | {held['ece']:.1%} |",
            "",
            "The game shows "
            + (
                "the temperature-scaled probabilities, because they lowered held-out NLL."
                if cal["ships"]
                else "the raw probabilities: temperature scaling did not lower held-out NLL."
            ),
            "",
            "| Atlas said | Photos | Right country |",
            "| --- | ---: | ---: |",
            *(
                f"| {b['lo']:.0%} to {b['hi']:.0%} (mean {b['confidence']:.0%}) | {b['n']} | "
                f"{b['accuracy']:.0%} |"
                for b in (held if cal["ships"] else raw)["bins"]
            ),
        ]
    heads = report.get("clue_heads")
    if heads:
        lines += [
            "",
            "## Clue heads: do trained probes read the scene better than today's clues?",
            "",
            "Logistic-regression probes on frozen CLIP image embeddings "
            f"({heads[0]['model']}), fitted on {heads[0]['references']:,} reference photos "
            "labelled by their coordinates (Köppen-Geiger climate group, driving side of the "
            "country). Each game photo is predicted by a probe that never saw a reference photo "
            "from its 10° geographic block, and scored against the game photo's own map label. "
            "A probe writes its clue at the reveal only if the paired 95% interval of the "
            "accuracy difference is above zero.",
            "",
            "| Concept | Photos | Probe | Compared with | Their accuracy | Commonest class "
            "| Difference (95% CI) | Writes the clue |",
            "| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |",
            *(
                f"| {h['concept'].replace('_', ' ')} | {h['n']} | {h['headAccuracy']:.1%} | "
                f"{h['baseline']} | {h['baselineAccuracy']:.1%} | {h['majorityAccuracy']:.1%} | "
                f"{h['accuracyDelta']:+.1%} ({h['ci95'][0]:+.1%} to {h['ci95'][1]:+.1%}) | "
                f"{'yes' if h['ships'] else 'no'} |"
                for h in heads
            ),
        ]
    pheads = report.get("pocket_clue_heads")
    if pheads:
        lines += [
            "",
            "## Pocket Atlas: do clue heads read your photo better?",
            "",
            f"The same probes, fitted on {pheads[0]['references']:,} reference photos embedded by "
            f"the browser's model ({pheads[0]['model']}), scored the same way against what "
            '"Try Atlas on your photo" shows today: its zero-shot climate clue, and the driving '
            "side of the country it guessed. A probe that clearly wins ships in the browser's "
            "index and writes that clue for players' own photos. The game's Atlas is never "
            "changed by these rows.",
            "",
            "| Concept | Photos | Probe | Compared with | Their accuracy | Difference (95% CI) "
            "| Runs in the browser |",
            "| --- | ---: | ---: | --- | ---: | ---: | --- |",
            *(
                f"| {h['concept'].replace('_', ' ')} | {h['n']} | {h['headAccuracy']:.1%} | "
                f"{h['baseline']} | {h['baselineAccuracy']:.1%} | "
                f"{h['accuracyDelta']:+.1%} ({h['ci95'][0]:+.1%} to {h['ci95'][1]:+.1%}) | "
                f"{'yes' if h['ships'] else 'no'} |"
                for h in pheads
            ),
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
        "- **Little training.** Atlas v0 is zero-shot. The clue heads and the geocell head are "
        "small classifiers fitted on frozen embeddings of the reference photos, and each plays "
        "only where it clearly beats what it would replace.",
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
    ap.add_argument(
        "--saliency-budget-minutes",
        type=float,
        default=None,
        help="stop starting new maps after this long; the rest wait for a later run",
    )
    ap.add_argument(
        "--references",
        type=Path,
        default=None,
        help="reference photos CSV (whereabout_ml.reference_set) for retrieval refinement",
    )
    ap.add_argument("--reference-images", type=Path, default=Path(".cache/references"))
    ap.add_argument(
        "--retrieval-model",
        type=parse_model,
        default=None,
        help="MODEL:PRETRAINED whose image embeddings the retrieval compares (one of --model; "
        "default: the first)",
    )
    ap.add_argument("--max-references", type=int, default=None)
    ap.add_argument(
        "--labels",
        type=Path,
        default=None,
        help="the catalog's concept labels (data/labels/concept_labels.csv), the clue heads' truth",
    )
    ap.add_argument(
        "--reference-labels",
        type=Path,
        default=None,
        help="the reference photos' concept labels (data/reference/concept_labels.csv); with "
        "--labels and --references, fits and scores the clue heads",
    )
    ap.add_argument(
        "--embedding-cache",
        type=Path,
        default=Path(".cache/embeddings"),
        help="image embeddings kept between runs, so only new photos are encoded",
    )
    ap.add_argument(
        "--pocket-model",
        type=parse_model,
        default=None,
        help="MODEL:PRETRAINED Pocket Atlas runs in the browser (one of --model): writes its "
        "temperature and reality-check bands to RESULTS_DIR/pocket-calibration.json",
    )
    args = ap.parse_args(argv)
    models = args.models or [("ViT-B-32", "laion2b_s34b_b79k")]
    if args.pocket_model and args.pocket_model not in models:
        raise SystemExit(f"--pocket-model {':'.join(args.pocket_model)} is not one of --model")

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
    handles: dict[str, tuple[ClipEncoder, ZeroShotGeolocator, list[np.ndarray]]] = {}
    by_model: dict[tuple[str, str], tuple[ClipEncoder, list[np.ndarray]]] = {}
    locators: dict[tuple[str, str], ZeroShotGeolocator] = {}
    for name, pretrained in models:
        started = time.perf_counter()
        encoder = ClipEncoder(name, pretrained)
        locator = ZeroShotGeolocator(encoder, gazetteer, report_top_countries=REVEAL_TOP_COUNTRIES)
        embeddings, cached = cached_image_embeddings(
            encoder, [p.id for p in photos], paths, args.embedding_cache
        )
        full = [locator.predict(e) for e in embeddings]
        country_only = [locator.predict_country_only(e) for e in embeddings]
        seconds = time.perf_counter() - started
        print(
            f"{encoder.name}: {len(photos)} photos in {seconds:.0f}s "
            f"({cached.encoded} encoded, {cached.reused} from the embedding cache)"
        )
        handles[f"{encoder.name}, country then city"] = (encoder, locator, list(embeddings))
        by_model[(name, pretrained)] = (encoder, list(embeddings))
        locators[(name, pretrained)] = locator
        systems.append(
            System(f"{encoder.name}, country only", predictions_from_guesses(photos, country_only))
        )
        systems.append(
            System(
                f"{encoder.name}, country then city", predictions_from_guesses(photos, full), full
            )
        )

    for s in systems:
        s.report = evaluate(s.predictions)
    best = pick_best(systems)

    retrieval: dict | None = None
    index: ReferenceIndex | None = None
    ref_dropped: dict[str, int] = {}
    r_encoder = r_embeddings = None
    if args.references is not None:
        spec = args.retrieval_model or models[0]
        if spec not in by_model:
            raise SystemExit(f"--retrieval-model {spec} is not one of the --model runs")
        r_encoder, r_embeddings = by_model[spec]
        try:
            index, ref_dropped = load_reference_index(
                args.references,
                args.reference_images,
                photos,
                paths,
                r_encoder,
                args.embedding_cache,
                args.max_references,
            )
        except Exception as err:  # noqa: BLE001 - the refinement is optional; v0 still ships
            index, ref_dropped = None, {}
            print(f"retrieval failed, shipping Atlas without it: {err!r}", file=sys.stderr)
        if index is not None and len(index):
            refined, retrieval = refine_with_references(
                photos, best, r_embeddings, index, model=r_encoder.name, dropped=ref_dropped
            )
            refined.report = evaluate(refined.predictions)
            systems.append(refined)
            print(
                f"retrieval: moved the pin on {retrieval['moved']} of {retrieval['n']} photos; "
                f"median km change "
                f"{retrieval['median_km_delta']} (95% CI {retrieval['ci95']}); "
                f"{'plays in the game' if retrieval['ships'] else 'does not ship'}"
            )
            if retrieval["ships"]:
                handles[refined.name] = handles[best.name]
                best = refined
        elif index is not None:
            print("retrieval: no reference photos with thumbnails yet; skipped", file=sys.stderr)
    geocell: dict | None = None
    if index is not None and len(index):
        try:
            fitted = fit_geocell_head(photos, best, r_embeddings, index, model=r_encoder.name)
        except Exception as err:  # noqa: BLE001 - the head is optional; v0 still ships
            fitted = None
            print(f"geocell head failed, shipping Atlas without it: {err!r}", file=sys.stderr)
        if fitted is None:
            print("geocell head: too few reference photos to fit; skipped")
        else:
            (alone, within), geocell = fitted
            for s in (alone, within):
                s.report = evaluate(s.predictions)
            systems += [alone, within]
            print(
                f"geocell head: {geocell['cells']} cells; alone median "
                f"{alone.report.median_km:.0f} km; within the country it moved the pin on "
                f"{geocell['moved']} of {geocell['n']} photos, median km change "
                f"{geocell['median_km_delta']} (95% CI {geocell['ci95']}); "
                f"{'plays in the game' if geocell['ships'] else 'does not ship'}"
            )
            if geocell["ships"]:
                handles[within.name] = handles[best.name]
                best = within
    encoder, locator, best_embeddings = handles[best.name]
    best.guesses, beliefs, calibration = calibrate_guesses(
        photos, best.guesses, best_embeddings, locator
    )
    print(
        f"calibration: T = {calibration['temperature']}; held-out NLL "
        f"{calibration['raw']['nll']} raw, {calibration['calibrated']['nll']} calibrated; "
        f"{'ships' if calibration['ships'] else 'raw probabilities ship'}"
    )

    clue_heads: list[dict] | None = None
    if (
        index is not None
        and len(index)
        and args.labels is not None
        and args.reference_labels is not None
        and args.labels.exists()
        and args.reference_labels.exists()
    ):
        try:
            best.guesses, clue_heads = fit_clue_heads(
                photos,
                best.guesses,
                best_embeddings,
                locator,
                r_embeddings,
                index,
                args.labels,
                args.reference_labels,
                model=r_encoder.name,
            )
        except Exception as err:  # noqa: BLE001 - clue heads are optional; the clues stay v0's
            clue_heads = None
            print(f"clue heads failed, keeping the zero-shot clues: {err!r}", file=sys.stderr)
        for h in clue_heads or []:
            print(
                f"clue head {h['concept']}: {h['headAccuracy']:.1%} vs {h['baseline']} "
                f"{h['baselineAccuracy']:.1%} on {h['n']} photos (95% CI {h['ci95']}); "
                f"{'writes the clue' if h['ships'] else 'does not ship'}"
            )

    pocket_ret: dict | None = None
    pocket_heads: list[dict] | None = None
    p_index: ReferenceIndex | None = None
    if args.pocket_model and index is not None and len(index):
        p_encoder, p_embeddings = by_model[args.pocket_model]
        p_base = next(s for s in systems if s.name == f"{p_encoder.name}, country then city")
        try:
            p_index = (
                index
                if p_encoder is r_encoder
                else reembed_references(
                    index, args.reference_images, p_encoder, args.embedding_cache
                )
            )
            p_system, pocket_ret = pocket_retrieval(
                photos, p_base, p_embeddings, p_index, model=p_encoder.name, dropped=ref_dropped
            )
            p_system.report = evaluate(p_system.predictions)
            systems.append(p_system)
            print(
                f"pocket retrieval ({p_encoder.name}): moved the pin on {pocket_ret['moved']} of "
                f"{pocket_ret['n']} photos; median km change {pocket_ret['median_km_delta']} "
                f"(95% CI {pocket_ret['ci95']}); "
                f"{'turns on in the browser' if pocket_ret['ships'] else 'stays off'}"
            )
        except Exception as err:  # noqa: BLE001 - a score for the browser; never lose the game
            pocket_ret = None
            print(f"pocket retrieval failed, Pocket Atlas stays as it is: {err!r}", file=sys.stderr)
        if (
            p_index is not None
            and args.labels is not None
            and args.reference_labels is not None
            and args.labels.exists()
            and args.reference_labels.exists()
        ):
            try:
                pocket_heads = pocket_clue_heads(
                    photos,
                    p_base,
                    p_embeddings,
                    locators[args.pocket_model],
                    p_index,
                    args.labels,
                    args.reference_labels,
                    model=p_encoder.name,
                )
            except Exception as err:  # noqa: BLE001 - the browser keeps its zero-shot clues
                pocket_heads = None
                print(
                    f"pocket clue heads failed, Pocket Atlas keeps its zero-shot clues: {err!r}",
                    file=sys.stderr,
                )
            for h in pocket_heads or []:
                print(
                    f"pocket clue head {h['concept']} ({h['model']}): {h['headAccuracy']:.1%} vs "
                    f"{h['baseline']} {h['baselineAccuracy']:.1%} on {h['n']} photos "
                    f"(95% CI {h['ci95']}); "
                    f"{'runs in the browser' if h['ships'] else 'stays off'}"
                )

    saliency: dict[str, Saliency] = {}
    if args.saliency_grid > 0:
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
                budget_s=(
                    None
                    if args.saliency_budget_minutes is None
                    else args.saliency_budget_minutes * 60
                ),
            )
            left = len(photos) - len(saliency)
            print(
                f"saliency: {len(saliency)} photos in {time.perf_counter() - started:.0f}s; "
                f"{left} left for a later run"
            )
        except Exception as err:  # noqa: BLE001 - maps are a bonus; never lose the guesses
            saliency = {}
            print(f"saliency failed, shipping guesses without maps: {err!r}", file=sys.stderr)

    atlas, report, markdown = build_outputs(
        photos,
        systems,
        skipped=skipped,
        saliency=saliency,
        beliefs=beliefs,
        retrieval=retrieval,
        calibration=calibration,
        clue_heads=clue_heads,
        geocell=geocell,
        pocket_retrieval=pocket_ret,
        pocket_clue_heads=pocket_heads,
    )
    args.atlas_out.write_text(json.dumps(atlas, indent=1, ensure_ascii=False) + "\n")
    args.results_dir.mkdir(parents=True, exist_ok=True)
    (args.results_dir / "atlas-v0.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    )
    (args.results_dir / "atlas-v0.md").write_text(markdown)
    if args.pocket_model:
        p_encoder, p_embeddings = by_model[args.pocket_model]
        pocket = pocket_calibration(
            photos, p_embeddings, locators[args.pocket_model], p_encoder.name
        )
        if pocket_ret is not None:
            # pocket-atlas-index reads this file: the verdict decides whether the index ships
            # the reference photos the browser's retrieval would search.
            pocket["retrieval"] = pocket_ret
        if pocket_heads is not None:
            # Shipping probes carry their weights, which `pocket-atlas-index` puts in the index.
            pocket["clueHeads"] = pocket_heads
        (args.results_dir / "pocket-calibration.json").write_text(
            json.dumps(pocket, indent=2) + "\n"
        )
        print(
            f"pocket calibration ({pocket['model']}): T = {pocket['fittedTemperature']}; held-out "
            f"NLL {pocket['raw']['nll']} raw, {pocket['calibrated']['nll']} calibrated; "
            f"{'ships' if pocket['ships'] else 'raw probabilities ship'}"
        )
    print(markdown)


if __name__ == "__main__":
    main()
