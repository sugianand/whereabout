"""Grow the game catalog from the Commons harvest.

    merge-harvest --catalog data/curation/photos.csv --harvested data/harvest/harvested.csv

`harvested.csv` (written by `whereabout_ml.harvest`) is already in `photos.csv` columns, and its
rows are in the harvester's grid-balancing order: each one came from the cell that held the
fewest photos at the time. By default every new row is merged; an optional `--limit` takes
only the first new rows, which still grows the catalog evenly across the map, and a later run
picks up where that one stopped.

A harvested row is skipped when its id or its Commons page is already in the catalog, and the
run fails without writing anything if a row is malformed (missing column, credit or license,
coordinates out of range), so a bad harvest never reaches players. Catalog rows are written
back unchanged and in order; new rows are appended.

Every catalog photo needs Atlas's precomputed guess before the game deals it
(`web/src/lib/game/playable.ts`). Merges used to stop at 150 photos because the Atlas workflow
re-encoded the whole catalog and mapped every new photo in one run on a CPU runner with a time
limit. It now reuses cached embeddings and spreads new saliency maps over runs under a time
budget (`run_atlas_v0.py`), so a whole harvest can join the game at once.
"""

from __future__ import annotations

import argparse
import csv
import io
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

FIELDS = ("id", "image_url", "lat", "lon", "place", "country", "author", "license", "source_url")
REQUIRED = ("id", "image_url", "place", "country", "author", "license", "source_url")


@dataclass(frozen=True)
class MergeResult:
    rows: list[dict[str, str]]  # the whole catalog after the merge
    added: list[str]  # ids appended, in order
    already: int  # harvested rows whose id or Commons page was in the catalog
    left: int  # new harvested rows not merged because of the limit


def check_row(row: Mapping[str, str], where: str) -> None:
    """Raise ValueError unless `row` is a complete, valid catalog row."""
    missing = [f for f in FIELDS if f not in row]
    if missing:
        raise ValueError(f"{where}: missing columns {missing}")
    empty = [f for f in REQUIRED if not (row[f] or "").strip()]
    if empty:
        raise ValueError(f"{where}: empty {empty}")
    try:
        lat, lon = float(row["lat"]), float(row["lon"])
    except ValueError as err:
        raise ValueError(f"{where}: coordinates are not numbers") from err
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"{where}: coordinates out of range ({lat}, {lon})")
    if not row["image_url"].startswith("https://") or not row["source_url"].startswith("https://"):
        raise ValueError(f"{where}: image and source URLs must be https")
    if len(row["country"]) != 2 or not row["country"].isalpha() or not row["country"].isupper():
        raise ValueError(f"{where}: country must be an ISO alpha-2 code, got {row['country']!r}")


def merge(
    catalog: Sequence[Mapping[str, str]],
    harvested: Sequence[Mapping[str, str]],
    limit: int | None = None,
) -> MergeResult:
    """Append the harvested rows that are not in the catalog yet, at most `limit` if given."""
    if limit is not None and limit < 0:
        raise ValueError(f"limit must be >= 0, got {limit}")
    for i, row in enumerate(harvested, start=2):  # line numbers as in the CSV file
        check_row(row, f"harvested.csv line {i}")
    ids = {r["id"] for r in catalog}
    pages = {r["source_url"] for r in catalog}
    out = [{f: r[f] for f in FIELDS} for r in catalog]
    added: list[str] = []
    already = left = 0
    for row in harvested:
        if row["id"] in ids or row["source_url"] in pages:
            already += 1
            continue
        if limit is not None and len(added) >= limit:
            left += 1
            continue
        out.append({f: row[f] for f in FIELDS})
        ids.add(row["id"])
        pages.add(row["source_url"])
        added.append(row["id"])
    return MergeResult(out, added, already, left)


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def to_csv(rows: Sequence[Mapping[str, str]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=FIELDS, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--catalog", type=Path, default=Path("data/curation/photos.csv"))
    ap.add_argument("--harvested", type=Path, default=Path("data/harvest/harvested.csv"))
    ap.add_argument(
        "--limit", type=int, default=None, help="most new photos per run (default: all)"
    )
    args = ap.parse_args(argv)

    header, catalog = read_rows(args.catalog)
    if tuple(header) != FIELDS:
        raise SystemExit(f"{args.catalog}: expected columns {FIELDS}, got {tuple(header)}")
    _, harvested = read_rows(args.harvested)
    result = merge(catalog, harvested, args.limit)
    if result.added:
        args.catalog.write_text(to_csv(result.rows), encoding="utf-8")
    print(
        f"added {len(result.added)} photos (catalog now {len(result.rows)}); "
        f"{result.already} already in the catalog, {result.left} left for a later run"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
