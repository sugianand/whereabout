"""Find 360° panorama candidates on Wikimedia Commons for the game, ready for review by eye.

A full spherical panorama is stored as an equirectangular image: 360° of longitude across,
180° of latitude down, so it is exactly twice as wide as it is tall. This module searches
Commons, keeps files with that shape that pass the same license, credit, privacy and
coordinate checks as every other photo (`whereabout_ml.ingest.check_file`), removes
near-duplicates, spreads the survivors over the world, and writes:

    panorama-candidates --out-dir data/curation/panoramas --limit 60

- `candidates.csv`: one row per candidate with the image URL the game would load, the camera
  location, author and license;
- `sheets/sheet-NN.jpg`: contact sheets with each candidate's number, for the review by eye
  that decides what enters `data/curation/photos.csv` (people, indoor scenes, giveaway signs);
- `candidates.meta.json`: counts per step and per rejection reason.
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.parse
from collections import Counter
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from whereabout_ml import ingest
from whereabout_ml.concept_labels import download

# CirrusSearch queries over the File namespace. Pano360 is the template Commons uses to mark
# files its own 360° viewer can open; the others catch panoramas tagged only by category or
# description. The aspect-ratio check below is what actually decides.
QUERIES = (
    "filetype:bitmap hastemplate:Pano360",
    'filetype:bitmap incategory:"Spherical_panoramas"',
    'filetype:bitmap incategory:"360°_panoramas"',
    'filetype:bitmap "equirectangular" filew:>3999',
)
GAME_WIDTH = 3840  # a standard Wikimedia thumbnail width, and within WebGL's 4096 texture limit
SHEET_WIDTH = 960
ASPECT_TOLERANCE = 0.01
MIN_WIDTH = 4000
CELL_DEG = 15.0

CANDIDATE_FIELDS = (
    "n",
    "pageid",
    "title",
    "source_url",
    "image_url",
    "width",
    "height",
    "lat",
    "lon",
    "author",
    "license",
    "phash",
)


def search_url(query: str, api_url: str, thumb_width: int, offset: int = 0) -> str:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": "6",
        "gsrlimit": "50",
        "gsroffset": str(offset),
        "prop": "imageinfo",
        "iiprop": "url|size|sha1|mime|extmetadata",
        "iiextmetadatafilter": "|".join(ingest.EXTMETADATA),
        "iiurlwidth": str(thumb_width),
    }
    return f"{api_url}?{urllib.parse.urlencode(params)}"


def search(
    query: str,
    *,
    get_json: Callable[[str], Mapping],
    api_url: str = ingest.COMMONS_API,
    thumb_width: int = SHEET_WIDTH,
    max_results: int = 2000,
) -> Iterator[ingest.CommonsFile]:
    """Every file a search returns, following `continue` until `max_results`."""
    offset = 0
    while offset < max_results:
        data = get_json(search_url(query, api_url, thumb_width, offset))
        for page in data.get("query", {}).get("pages", []):
            file = ingest.parse_page(page)
            if file is not None:
                yield file
        nxt = data.get("continue", {}).get("gsroffset")
        if nxt is None:
            return
        offset = int(nxt)


def is_equirectangular(width: int, height: int, tolerance: float = ASPECT_TOLERANCE) -> bool:
    """A full 360°×180° panorama is 2:1 to within a pixel or two of rounding."""
    return height > 0 and abs(width / height - 2.0) <= 2.0 * tolerance


def game_url(thumb_url: str, width: int) -> str:
    """The thumbnail URL rewritten to `width` px (Commons thumbs encode it as `NNNpx-`)."""
    head, sep, tail = thumb_url.rpartition("/")
    if not sep or "px-" not in tail:
        return thumb_url  # the original itself: the file is smaller than any thumbnail
    return f"{head}/{width}px-{tail.split('px-', 1)[1]}"


def spread(items: Sequence[ingest.Accepted], per_cell: int, cell_deg: float = CELL_DEG):
    """At most `per_cell` items per lat/lon cell (largest first), so no region dominates."""
    counts: Counter[tuple[int, int]] = Counter()
    kept = []
    for a in sorted(items, key=lambda a: (-a.file.pixels, a.file.pageid)):
        cell = (math.floor(a.lat / cell_deg), math.floor(a.lon / cell_deg))
        if counts[cell] < per_cell:
            counts[cell] += 1
            kept.append(a)
    return kept


@dataclass
class Harvest:
    candidates: list[dict[str, str]]
    meta: dict[str, object]


def harvest(
    cache_dir: Path,
    *,
    queries: Sequence[str] = QUERIES,
    exclude_titles: frozenset[str] = frozenset(),
    get_json: Callable[[str], Mapping] = ingest.http_get_json,
    fetch: Callable[[str, Path], bool] = download,
    limit: int = 60,
    per_cell: int = 2,
    max_results: int = 2000,
) -> Harvest:
    found: dict[int, ingest.CommonsFile] = {}
    per_query: dict[str, int] = {}
    for q in queries:
        n = 0
        for f in search(q, get_json=get_json, max_results=max_results):
            n += 1
            found.setdefault(f.pageid, f)
        per_query[q] = n
        print(f"{n:5d} files  {q}")

    reasons: Counter[str] = Counter()
    accepted: list[ingest.Accepted] = []
    for f in found.values():
        if f.title in exclude_titles:
            reasons["already in the catalog"] += 1
        elif not is_equirectangular(f.width, f.height):
            reasons["not 2:1 equirectangular"] += 1
        elif f.width < MIN_WIDTH:
            reasons[f"narrower than {MIN_WIDTH} px"] += 1
        else:
            checked = ingest.check_file(f)
            if isinstance(checked, str):
                reasons[checked.split(":")[0]] += 1
            else:
                accepted.append(checked)

    spread_out = spread(accepted, per_cell)
    hashed: dict[str, tuple[ingest.Accepted, int]] = {}
    for a in spread_out:
        if len(hashed) >= limit * 2:  # hashing is the slow part; leave room for duplicates
            break
        path = cache_dir / f"{a.file.pageid}.jpg"
        if not path.exists() and not fetch(a.file.thumb_url, path):
            reasons["thumbnail not available"] += 1
            continue
        try:
            hashed[str(a.file.pageid)] = (a, ingest.phash_file(path))
        except OSError:
            reasons["unreadable image"] += 1
    dups = {
        d.key
        for d in ingest.dedupe([ingest.Hashed(k, h, a.file.pixels) for k, (a, h) in hashed.items()])
    }
    reasons["near-duplicate"] += len(dups)

    rows = []
    for key, (a, h) in hashed.items():
        if key in dups or len(rows) >= limit:
            continue
        rows.append(
            {
                "n": str(len(rows) + 1),
                "pageid": key,
                "title": a.file.title,
                "source_url": a.file.source_url,
                "image_url": game_url(a.file.thumb_url, GAME_WIDTH),
                "width": str(a.file.width),
                "height": str(a.file.height),
                "lat": f"{a.lat:.6f}",
                "lon": f"{a.lon:.6f}",
                "author": a.author,
                "license": a.license,
                "phash": f"{h:016x}",
            }
        )
    meta = {
        "files_found": len(found),
        "per_query": per_query,
        "passed_checks": len(accepted),
        "after_spreading": len(spread_out),
        "candidates": len(rows),
        "dropped": dict(sorted((k, v) for k, v in reasons.items() if v)),
        "settings": {
            "min_width": MIN_WIDTH,
            "aspect_tolerance": ASPECT_TOLERANCE,
            "cell_deg": CELL_DEG,
            "per_cell": per_cell,
            "game_width": GAME_WIDTH,
        },
    }
    return Harvest(rows, meta)


def contact_sheets(
    rows: Sequence[Mapping[str, str]], cache_dir: Path, out_dir: Path, per_sheet: int = 8
) -> list[Path]:
    """JPEG sheets of numbered thumbnails, two columns, for review by eye."""
    from PIL import Image, ImageDraw, ImageFont

    tile_w, tile_h, label_h, cols = 720, 360, 28, 2
    font = ImageFont.load_default(size=18)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for start in range(0, len(rows), per_sheet):
        chunk = rows[start : start + per_sheet]
        n_rows = math.ceil(len(chunk) / cols)
        sheet = Image.new("RGB", (cols * tile_w, n_rows * (tile_h + label_h)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, row in enumerate(chunk):
            x, y = (i % cols) * tile_w, (i // cols) * (tile_h + label_h)
            with Image.open(cache_dir / f"{row['pageid']}.jpg") as im:
                sheet.paste(im.convert("RGB").resize((tile_w - 8, tile_h)), (x + 4, y))
            label = f"#{row['n']}  {row['lat']}, {row['lon']}  {row['title'][5:60]}"
            draw.text((x + 6, y + tile_h + 4), label, fill="black", font=font)
        path = out_dir / f"sheet-{start // per_sheet + 1:02d}.jpg"
        sheet.save(path, quality=80)
        paths.append(path)
    return paths


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--catalog", type=Path, help="skip files already in this catalog")
    ap.add_argument("--cache-dir", type=Path, default=Path(".cache/panoramas"))
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--per-cell", type=int, default=2)
    args = ap.parse_args(argv)

    exclude = frozenset(ingest.titles_from_catalog(args.catalog)) if args.catalog else frozenset()
    result = harvest(
        args.cache_dir,
        exclude_titles=exclude,
        get_json=ingest.http_get_json,
        limit=args.limit,
        per_cell=args.per_cell,
    )
    ingest.write_csv(args.out_dir / "candidates.csv", CANDIDATE_FIELDS, result.candidates)
    sheets = contact_sheets(result.candidates, args.cache_dir, args.out_dir / "sheets")
    result.meta["sheets"] = len(sheets)
    (args.out_dir / "candidates.meta.json").write_text(
        json.dumps(result.meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(result.meta, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
