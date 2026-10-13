"""Calibrate the scene gate on the catalog and a labelled reject fixture.

    scene-gate --catalog data/curation/photos.csv --rejects data/scene_gate/rejects.csv \\
               --images .cache/images --out data/scene_gate

The catalog photos were all reviewed by hand and are known-good, so each reason's threshold is
set just above the highest score any of them gets (`--max-false-reject` relaxes that). The
fixture (columns title,label,image_url,author,license,source_url; label is a reason) then
shows how many known-bad photos that threshold catches. Writes thresholds.json, report.json,
report.md and scores.csv into `--out`.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path

from whereabout_ml.run_atlas_v0 import fetch, parse_model
from whereabout_ml.scene_gate import REASONS, SceneGate, calibrate, evaluate, to_markdown

DEFAULT_MODEL = ("ViT-B-32", "laion2b_s34b_b79k")


def reject_key(title: str) -> str:
    """Cache name for a reject image, derived from its Commons title so a rebuilt rejects.csv
    can never pair a row with another row's cached image."""
    return "reject-" + hashlib.sha1(title.encode()).hexdigest()[:12]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def cache_images(
    items: Sequence[tuple[str, str]], cache: Path, pause_s: float = 0.5
) -> tuple[dict[str, Path], dict[str, str]]:
    """Fetch each (key, url) once into `cache`; failures are reported, not fatal."""
    cache.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    failed: dict[str, str] = {}
    for key, url in items:
        if not url:
            failed[key] = "no image_url"
            continue
        suffix = ".png" if url.lower().endswith(".png") else ".jpg"
        path = cache / f"{re.sub(r'[^A-Za-z0-9._-]', '_', key)}{suffix}"
        if not path.exists():
            try:
                path.write_bytes(fetch(url))
            except Exception as err:  # noqa: BLE001 - reported per photo, not fatal
                failed[key] = str(err)
                print(f"skipping {key}: {err}", file=sys.stderr)
                continue
            time.sleep(pause_s)
        paths[key] = path
    return paths, failed


def run(
    catalog_rows: Sequence[Mapping[str, str]],
    reject_rows: Sequence[Mapping[str, str]],
    image_paths: Mapping[str, Path],
    encoder,
    *,
    model: str = "",
    max_false_reject: float = 0.0,
    out: Path,
) -> dict:
    """Score, calibrate, evaluate and write the four outputs. `image_paths` maps a catalog id
    or `reject_key(title)` to its file; rows without a file are skipped."""
    for row in reject_rows:
        if row["label"] not in REASONS:
            raise ValueError(f"unknown reject label {row['label']!r}; expected one of {REASONS}")
    catalog = [(r["id"], r["id"]) for r in catalog_rows if r["id"] in image_paths]
    rejects = [
        (reject_key(r["title"]), r["label"], r["title"])
        for r in reject_rows
        if reject_key(r["title"]) in image_paths
    ]
    if not catalog:
        raise ValueError("no catalog images available to calibrate on")

    gate = SceneGate(encoder)
    paths = [image_paths[k] for k, _ in catalog] + [image_paths[k] for k, _, _ in rejects]
    scores = gate.score_embeddings(encoder.encode_images(paths))
    keep_scores = scores[: len(catalog)]
    reject_scores = scores[len(catalog) :]

    thresholds = calibrate(keep_scores, max_false_reject)
    report = evaluate(
        keep_scores,
        [(lab, s) for (_, lab, _), s in zip(rejects, reject_scores, strict=True)],
        thresholds,
    )
    report["skipped"] = {
        "catalog": len(catalog_rows) - len(catalog),
        "rejects": len(reject_rows) - len(rejects),
    }

    out.mkdir(parents=True, exist_ok=True)
    (out / "thresholds.json").write_text(
        json.dumps(
            {"thresholds": thresholds, "model": model, "max_false_reject": max_false_reject},
            indent=2,
        )
        + "\n"
    )
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    markdown = to_markdown(report)
    (out / "report.md").write_text(markdown)
    with (out / "scores.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "set", "label", *REASONS])
        for (key, _), s in zip(catalog, keep_scores, strict=True):
            w.writerow([key, "catalog", "", *(f"{s[r]:.6f}" for r in REASONS)])
        for (_, label, title), s in zip(rejects, reject_scores, strict=True):
            w.writerow([title, "reject", label, *(f"{s[r]:.6f}" for r in REASONS)])
    return report


def main(argv: Sequence[str] | None = None, encoder_factory=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--catalog", type=Path, default=Path("data/curation/photos.csv"))
    ap.add_argument("--rejects", type=Path, default=Path("data/scene_gate/rejects.csv"))
    ap.add_argument("--images", type=Path, default=Path(".cache/images"))
    ap.add_argument("--out", type=Path, default=Path("data/scene_gate"))
    ap.add_argument(
        "--model",
        type=parse_model,
        default=DEFAULT_MODEL,
        help="open_clip MODEL:PRETRAINED (default {}:{})".format(*DEFAULT_MODEL),
    )
    ap.add_argument("--max-false-reject", type=float, default=0.0)
    args = ap.parse_args(argv)

    if encoder_factory is None:
        from whereabout_ml.clip_encoder import ClipEncoder as encoder_factory

    catalog_rows = read_csv(args.catalog)
    reject_rows = read_csv(args.rejects)
    items = [(r["id"], r["image_url"]) for r in catalog_rows] + [
        (reject_key(r["title"]), r["image_url"]) for r in reject_rows
    ]
    paths, failed = cache_images(items, args.images)
    if failed:
        print(f"{len(failed)} images unavailable: {sorted(failed)}", file=sys.stderr)

    encoder = encoder_factory(*args.model)
    report = run(
        catalog_rows,
        reject_rows,
        paths,
        encoder,
        model=encoder.name,
        max_false_reject=args.max_false_reject,
        out=args.out,
    )
    print((args.out / "report.md").read_text())
    return 0 if report["catalog"]["n"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
