"""Measure the real resolution and sharpness of every catalog photo.

    photo-quality --catalog data/curation/photos.csv --out data/curation/quality.csv \\
        --cache .cache/quality

For each photo: the original file's width and height from the Commons API, then a 1920 px
analysis image (or the original, if smaller) whose sharpness is the 90th percentile of the
variance of the Laplacian over a 4x4 grid of tiles, so smooth sky above a sharp horizon still
scores as sharp. The global Laplacian variance is reported alongside.
"""

from __future__ import annotations

import argparse
import csv
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from whereabout_ml.concept_labels import download
from whereabout_ml.ingest import BATCH, COMMONS_API, http_get_json, query_url, title_from_url

ANALYSIS_WIDTH = 1920
SHARPNESS_WIDTH = 1024
GRID = 4
FIELDS = ("id", "width", "height", "sharpness", "sharpness_global")


@dataclass(frozen=True)
class Size:
    width: int
    height: int
    url: str


def fetch_sizes(
    titles: Sequence[str],
    *,
    get_json: Callable[[str], Mapping] = http_get_json,
    api_url: str = COMMONS_API,
) -> dict[str, Size]:
    """{input title: original size and URL}, 50 titles per request; missing titles are absent."""
    out: dict[str, Size] = {}
    for start in range(0, len(titles), BATCH):
        batch = list(titles[start : start + BATCH])
        query = get_json(query_url(batch, api_url, 330)).get("query", {})
        canonical = {t: t for t in batch}
        for n in query.get("normalized", []):
            canonical[n["from"]] = n["to"]
        pages = {}
        for p in query.get("pages", []):
            info = (p.get("imageinfo") or [None])[0]
            if info and not p.get("missing"):
                pages[p.get("title")] = Size(
                    int(info.get("width", 0)), int(info.get("height", 0)), str(info.get("url", ""))
                )
        for title in batch:
            if canonical[title] in pages:
                out[title] = pages[canonical[title]]
    return out


def analysis_url(image_url: str, size: Size, target: int = ANALYSIS_WIDTH) -> str:
    """The URL of the analysis image: the original if it is small enough, else a thumbnail."""
    if size.width <= target:
        return size.url
    if "/1280px-" not in image_url:
        raise ValueError(f"not a 1280px thumbnail URL: {image_url}")
    return image_url.replace("/1280px-", f"/{target}px-", 1)


def laplacian(gray: np.ndarray) -> np.ndarray:
    """3x3 Laplacian (4-neighbour kernel) of the interior pixels."""
    g = gray.astype(np.float64)
    return g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4 * g[1:-1, 1:-1]


def sharpness(gray: np.ndarray, grid: int = GRID) -> tuple[float, float]:
    """(90th percentile of per-tile Laplacian variance, global Laplacian variance)."""
    lap = laplacian(gray)
    h, w = lap.shape
    variances = []
    for i in range(grid):
        for j in range(grid):
            tile = lap[i * h // grid : (i + 1) * h // grid, j * w // grid : (j + 1) * w // grid]
            if tile.size:
                variances.append(float(tile.var()))
    return float(np.percentile(variances, 90)), float(lap.var())


def measure_file(path: Path) -> tuple[float, float]:
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        g = ImageOps.exif_transpose(im).convert("L")
        if g.width != SHARPNESS_WIDTH:
            h = max(3, round(g.height * SHARPNESS_WIDTH / g.width))
            g = g.resize((SHARPNESS_WIDTH, h), Image.Resampling.LANCZOS)
        return sharpness(np.asarray(g))


def measure(
    catalog: Path,
    cache: Path,
    *,
    get_json: Callable[[str], Mapping] = http_get_json,
    fetch: Callable[[str, Path], bool] = download,
    api_url: str = COMMONS_API,
) -> list[dict[str, str]]:
    with catalog.open(newline="", encoding="utf-8") as fh:
        photos = list(csv.DictReader(fh))
    titles = [title_from_url(p["source_url"]) for p in photos]
    sizes = fetch_sizes(list(dict.fromkeys(titles)), get_json=get_json, api_url=api_url)
    cache.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, (photo, title) in enumerate(zip(photos, titles, strict=True), start=1):
        size = sizes.get(title)
        if size is None:
            print(f"skip {photo['id']}: not found on Commons")
            continue
        path = cache / f"{photo['id']}.jpg"
        if not path.exists() and not fetch(analysis_url(photo["image_url"], size), path):
            print(f"skip {photo['id']}: download failed")
            continue
        try:
            sharp, glob = measure_file(path)
        except OSError as err:
            print(f"skip {photo['id']}: unreadable image: {err}")
            continue
        rows.append(
            {
                "id": photo["id"],
                "width": str(size.width),
                "height": str(size.height),
                "sharpness": f"{sharp:.2f}",
                "sharpness_global": f"{glob:.2f}",
            }
        )
        if i % 25 == 0:
            print(f"measured {i}/{len(photos)}")
    return rows


def write_quality(path: Path, rows: Sequence[Mapping[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def summarize(rows: Sequence[Mapping[str, str]], n: int = 10) -> str:
    def lowest(key: str) -> str:
        worst = sorted(rows, key=lambda r: (float(r[key]), r["id"]))[:n]
        return "\n".join(f"- {r['id']}: {r[key]}" for r in worst)

    return (
        f"## Photo quality\n\n{len(rows)} photos measured.\n\n"
        f"### Lowest sharpness\n\n{lowest('sharpness')}\n\n"
        f"### Lowest width\n\n{lowest('width')}\n"
    )


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--catalog", type=Path, default=Path("data/curation/photos.csv"))
    ap.add_argument("--out", type=Path, default=Path("data/curation/quality.csv"))
    ap.add_argument("--cache", type=Path, default=Path(".cache/quality"))
    ap.add_argument("--api-url", default=COMMONS_API)
    args = ap.parse_args(argv)
    rows = measure(args.catalog, args.cache, api_url=args.api_url)
    write_quality(args.out, rows)
    print(summarize(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
