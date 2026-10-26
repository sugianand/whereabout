"""Label the photo catalog with concepts looked up from the real climate and land-cover maps.

`maps.py` knows how to read the maps; this module fetches the parts of them the catalog needs,
proves they say what we think they say, and writes one row of labels per photo:

    concept-labels --catalog data/curation/photos.csv --maps-dir data/maps \\
        --known-places data/fixtures/concept_places.json \\
        --out data/labels/concept_labels.csv --download

1. Fetch (only with `--download`): the 1 km Köppen-Geiger GeoTIFF for 1991-2020 out of Beck et
   al.'s figshare archive, plus its `legend.txt`, and the ESA WorldCover 3°×3° tiles that
   contain a catalog photo or a known place. Tiles over open sea do not exist and are skipped.
2. Check: the archive's legend must match `maps.KOPPEN_GEIGER` code for code, and every known
   place (London is "Cfb", the Greenland ice sheet is "Snow and ice", ...) must read as one of
   its accepted labels from the real maps. Any failure stops the run before a label is written,
   so a wrong legend or a misread tile can never reach the training data.
3. Label: climate, its Köppen group, land cover (majority within ~150 m) and the driving side
   (from the catalog's curated country) for each photo; a sidecar JSON records provenance.
4. With `--references`, also label the retrieval reference photos (`data/reference/`) with
   climate, Köppen group and driving side (from their GeoNames country), the training labels
   for Atlas's clue heads (`whereabout_ml.clue_heads`). Land cover is left out: thousands of
   reference photos would need hundreds of 10 m tiles, and no clue head uses it.

        concept-labels ... --references data/reference/references.csv \\
            --references-out data/reference/concept_labels.csv

Downloads go through urllib so the module needs nothing beyond `ml[maps]`; tests point the
URLs at `file://` fixtures.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from whereabout_api.catalog import load_catalog
from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_ml.labels import driving_side
from whereabout_ml.maps import (
    KOPPEN_GEIGER,
    CategoricalMap,
    koppen_geiger_map,
    koppen_group,
    worldcover_map,
    worldcover_tile,
)

if TYPE_CHECKING:  # retrieval imports this module (through ingest), so only for annotations
    from whereabout_ml.retrieval import Reference

USER_AGENT = "WhereaboutBot/0.1 (https://github.com/sugianand/whereabout; research demo)"

# Beck et al. (2023), "High-resolution (1 km) Köppen-Geiger maps for 1901-2099", CC BY 4.0.
KOPPEN_ARTICLE_URL = "https://api.figshare.com/v2/articles/21789074"
KOPPEN_ARCHIVE = re.compile(r"koppen_geiger_tif\.zip$")
KOPPEN_MEMBER = re.compile(r"(^|/)1991_2020/koppen_geiger_0p00833333\.tif$")
KOPPEN_FILE = "koppen_geiger_0p00833333.tif"
KOPPEN_LEGEND = "koppen_legend.txt"

# ESA WorldCover 2021 v200, public bucket, CC BY 4.0.
WORLDCOVER_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
WORLDCOVER_DIR = "worldcover"

FIELDS = ("id", "climate", "climate_group", "land_cover", "driving_side")
REFERENCE_FIELDS = ("id", "climate", "climate_group", "driving_side")


# --- fetching --------------------------------------------------------------------------------


def download(url: str, dest: Path, *, attempts: int = 4, backoff_s: float = 2.0) -> bool:
    """Stream `url` to `dest`. False if the server says it does not exist (404 / no file),
    True once written; retries throttling, server errors and dropped connections.

    The body goes to a temporary name first, so an interrupted download never leaves a
    truncated file that a later run would mistake for a complete one.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp, partial.open("wb") as out:
                shutil.copyfileobj(resp, out, length=1 << 20)
            partial.replace(dest)
            return True
        except urllib.error.HTTPError as err:
            if err.code in (403, 404):  # S3 answers 403 for a key that isn't there
                return False
            if err.code not in (429, 500, 502, 503, 504):
                raise
            last = err
        except urllib.error.URLError as err:
            if isinstance(err.reason, FileNotFoundError):  # file:// URL without a file
                return False
            last = err
        except (ConnectionError, TimeoutError) as err:
            last = err
        partial.unlink(missing_ok=True)
        time.sleep(backoff_s * 2**attempt)
    raise RuntimeError(f"gave up on {url} after {attempts} attempts: {last}")


def needed_tiles(points: Sequence[LatLon]) -> list[str]:
    """WorldCover tile names covering `points`, sorted and without duplicates."""
    return sorted({worldcover_tile(p.lat, p.lon) for p in points})


def fetch_worldcover(
    names: Sequence[str], directory: Path, base_url: str = WORLDCOVER_URL
) -> tuple[list[str], list[str]]:
    """Download the named tiles that are not already in `directory`.

    Returns (available, absent): tiles now on disk, and tiles the server does not have (open
    sea). A point in an absent tile simply gets no land-cover label.
    """
    available, absent = [], []
    for i, name in enumerate(names, start=1):
        path = directory / name
        if path.exists() or download(f"{base_url.rstrip('/')}/{name}", path):
            available.append(name)
        else:
            absent.append(name)
        print(f"worldcover {i}/{len(names)}: {name} {'ok' if path.exists() else 'absent'}")
    return available, absent


def pick_file(article: Mapping, pattern: re.Pattern[str]) -> Mapping:
    """The one file of a figshare article whose name matches `pattern`."""
    files = article.get("files") or []
    matches = [f for f in files if pattern.search(f.get("name", ""))]
    if len(matches) != 1:
        names = ", ".join(f.get("name", "?") for f in files) or "none"
        raise LookupError(f"expected one file matching {pattern.pattern}, article has: {names}")
    return matches[0]


def pick_member(names: Sequence[str], pattern: re.Pattern[str]) -> str:
    """The shortest archive member matching `pattern` (the top-level one if there are several)."""
    matches = sorted((n for n in names if pattern.search(n)), key=lambda n: (len(n), n))
    if not matches:
        raise LookupError(f"no archive member matches {pattern.pattern}")
    return matches[0]


def fetch_koppen(directory: Path, article_url: str = KOPPEN_ARTICLE_URL) -> dict[str, str]:
    """Download Beck et al.'s archive once and keep only the 1991-2020 1 km map and the legend.

    Returns provenance: the archive's name, figshare file id and the members extracted.
    """
    req = urllib.request.Request(article_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        article = json.load(resp)
    entry = pick_file(article, KOPPEN_ARCHIVE)
    archive = directory / ".koppen_archive.zip"
    if not download(entry["download_url"], archive):
        raise FileNotFoundError(f"figshare file {entry['name']} is not downloadable")
    try:
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()
            tif = pick_member(names, KOPPEN_MEMBER)
            legend = pick_member(names, re.compile(r"(^|/)legend\.txt$"))
            for member, target in ((tif, KOPPEN_FILE), (legend, KOPPEN_LEGEND)):
                with zf.open(member) as src, (directory / target).open("wb") as out:
                    shutil.copyfileobj(src, out, length=1 << 20)
    finally:
        archive.unlink(missing_ok=True)
    return {
        "archive": str(entry["name"]),
        "figshare_file_id": str(entry.get("id", "")),
        "map_member": tif,
        "legend_member": legend,
    }


# --- checks ----------------------------------------------------------------------------------

_LEGEND_LINE = re.compile(r"^\s*(\d+)\s*:\s*([A-Z][A-Za-z]{1,2})\b")


def parse_koppen_legend(text: str) -> dict[int, str]:
    """{code: class} from the archive's legend.txt (lines like " 1:  Af  Tropical, ...")."""
    legend = {}
    for line in text.splitlines():
        m = _LEGEND_LINE.match(line)
        if m:
            legend[int(m.group(1))] = m.group(2)
    if not legend:
        raise ValueError("no 'code: class' lines found in the Köppen legend")
    return legend


def legend_mismatches(legend: Mapping[int, str]) -> list[str]:
    """Differences between a parsed legend and `maps.KOPPEN_GEIGER`; empty means they agree."""
    problems = []
    for code in sorted((set(legend) | set(KOPPEN_GEIGER)) - {0}):  # 0 (sea) is not a class
        ours, theirs = KOPPEN_GEIGER.get(code), legend.get(code)
        if ours != theirs:
            problems.append(f"code {code}: maps.py says {ours}, the legend says {theirs}")
    return problems


@dataclass(frozen=True)
class KnownPlace:
    """A place whose label on a real map is not in doubt, and the labels we accept there."""

    name: str
    point: LatLon
    concept: str
    accept: frozenset[str]


@dataclass(frozen=True)
class Check:
    place: KnownPlace
    got: str | None

    @property
    def ok(self) -> bool:
        return self.got in self.place.accept


def load_known_places(path: Path) -> list[KnownPlace]:
    places = []
    for item in json.loads(path.read_text(encoding="utf-8"))["places"]:
        accept = item["accept"]
        if not accept:
            raise ValueError(f"{item['name']}: accept must list at least one label")
        places.append(
            KnownPlace(
                item["name"], LatLon(item["lat"], item["lon"]), item["concept"], frozenset(accept)
            )
        )
    return places


def check_known_places(
    places: Sequence[KnownPlace], maps: Mapping[str, CategoricalMap]
) -> list[Check]:
    """Read every known place from the map for its concept."""
    checks = []
    for concept in sorted({p.concept for p in places}):
        if concept not in maps:
            raise KeyError(f"no map for concept {concept!r}")
        group = [p for p in places if p.concept == concept]
        got = maps[concept].labels([p.point for p in group])
        checks.extend(Check(p, g) for p, g in zip(group, got, strict=True))
    return checks


def checks_markdown(checks: Sequence[Check]) -> str:
    lines = ["| Place | Concept | Map says | Accepted | |", "| --- | --- | --- | --- | --- |"]
    for c in checks:
        accepted = ", ".join(sorted(c.place.accept))
        mark = "ok" if c.ok else "**FAIL**"
        lines.append(f"| {c.place.name} | {c.place.concept} | {c.got} | {accepted} | {mark} |")
    return "\n".join(lines)


# --- labelling -------------------------------------------------------------------------------


def label_catalog(
    photos: Sequence[Photo], climate: CategoricalMap, land_cover: CategoricalMap
) -> list[dict[str, str]]:
    """One row per photo; an unknown label is an empty cell, never a guess."""
    points = [p.location for p in photos]
    climates = climate.labels(points)
    covers = land_cover.labels(points)
    rows = []
    for photo, clim, cover in zip(photos, climates, covers, strict=True):
        row = {
            "id": photo.id,
            "climate": clim,
            "climate_group": koppen_group(clim),
            "land_cover": cover,
            "driving_side": driving_side(photo.country),
        }
        rows.append({k: v or "" for k, v in row.items()})
    return rows


def label_references(
    references: Sequence[Reference], climate: CategoricalMap
) -> list[dict[str, str]]:
    """Clue-head training labels for each reference photo; unknown is an empty cell."""
    climates = climate.labels([LatLon(r.lat, r.lon) for r in references])
    rows = []
    for ref, clim in zip(references, climates, strict=True):
        row = {
            "id": ref.id,
            "climate": clim,
            "climate_group": koppen_group(clim),
            "driving_side": driving_side(ref.country),
        }
        rows.append({k: v or "" for k, v in row.items()})
    return rows


def write_labels(
    rows: Sequence[Mapping[str, str]], path: Path, fields: Sequence[str] = FIELDS
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(fields), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def coverage(
    rows: Sequence[Mapping[str, str]], fields: Sequence[str] = FIELDS
) -> dict[str, dict[str, int]]:
    """Per concept, how many photos got each label ("" counted as "unlabelled")."""
    return {
        field: dict(sorted(Counter(r[field] or "unlabelled" for r in rows).items()))
        for field in fields[1:]
    }


# --- command line ----------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--maps-dir", type=Path, required=True)
    ap.add_argument("--known-places", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--download", action="store_true", help="fetch missing maps first")
    ap.add_argument("--koppen-article-url", default=KOPPEN_ARTICLE_URL)
    ap.add_argument("--worldcover-url", default=WORLDCOVER_URL)
    ap.add_argument(
        "--references", type=Path, default=None, help="reference photos CSV to label as well"
    )
    ap.add_argument("--references-out", type=Path, default=None)
    args = ap.parse_args(argv)
    if (args.references is None) != (args.references_out is None):
        ap.error("--references and --references-out go together")

    photos = load_catalog(args.catalog)
    places = load_known_places(args.known_places)
    tile_dir = args.maps_dir / WORLDCOVER_DIR
    koppen_path = args.maps_dir / KOPPEN_FILE
    legend_path = args.maps_dir / KOPPEN_LEGEND
    tiles = needed_tiles([p.location for p in photos] + [p.point for p in places])

    provenance: dict[str, object] = {}
    absent: list[str] = []
    if args.download:
        args.maps_dir.mkdir(parents=True, exist_ok=True)
        if not koppen_path.exists() or not legend_path.exists():
            provenance["koppen"] = fetch_koppen(args.maps_dir, args.koppen_article_url)
        _, absent = fetch_worldcover(tiles, tile_dir, args.worldcover_url)
    else:
        absent = [t for t in tiles if not (tile_dir / t).exists()]

    if not legend_path.exists():
        print(f"error: {legend_path} is missing; run with --download", file=sys.stderr)
        return 2
    problems = legend_mismatches(parse_koppen_legend(legend_path.read_text(encoding="utf-8")))
    if problems:
        print("error: Köppen legend does not match maps.KOPPEN_GEIGER:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1

    climate = koppen_geiger_map(koppen_path)
    land_cover = worldcover_map(tile_dir)
    try:
        checks = check_known_places(places, {"climate": climate, "land_cover": land_cover})
        print(checks_markdown(checks))
        failed = [c for c in checks if not c.ok]
        if failed:
            names = ", ".join(c.place.name for c in failed)
            print(f"error: known places read wrong from the real maps: {names}", file=sys.stderr)
            return 1
        rows = label_catalog(photos, climate, land_cover)
        from whereabout_ml.retrieval import load_references

        reference_rows = (
            label_references(load_references(args.references), climate)
            if args.references is not None
            else None
        )
    finally:
        climate.source.close()

    write_labels(rows, args.out)
    if reference_rows is not None:
        write_labels(reference_rows, args.references_out, REFERENCE_FIELDS)
        ref_meta = {
            "references": len(reference_rows),
            "coverage": coverage(reference_rows, REFERENCE_FIELDS),
            "sources": {
                "climate": "Köppen-Geiger 1991-2020, 1 km, Beck et al. (2023), CC BY 4.0",
                "driving_side": "GeoNames country of the nearest place + "
                "whereabout_ml.labels.LEFT_HAND_TRAFFIC",
            },
        }
        args.references_out.with_suffix(".meta.json").write_text(
            json.dumps(ref_meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"labelled {len(reference_rows)} reference photos -> {args.references_out}")
    meta = {
        "photos": len(rows),
        "coverage": coverage(rows),
        "known_places_checked": len(checks),
        "worldcover_tiles_needed": len(tiles),
        "worldcover_tiles_absent": absent,
        "sources": {
            "climate": "Köppen-Geiger 1991-2020, 1 km, Beck et al. (2023), CC BY 4.0",
            "land_cover": "ESA WorldCover 2021 v200, 10 m, majority within 15x15 px, CC BY 4.0",
            "driving_side": "catalog country + whereabout_ml.labels.LEFT_HAND_TRAFFIC",
        },
        **provenance,
    }
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"labelled {len(rows)} photos -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
