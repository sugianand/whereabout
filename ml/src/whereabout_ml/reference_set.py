"""Reference photos for Atlas's retrieval refinement: geotagged Commons files that are never
game photos.

    reference-set --gazetteer data/geonames --exclude data/curation/photos.csv \\
                  --exclude data/harvest/harvested.csv --out data/reference/references.csv \\
                  --images .cache/references --budget-minutes 30

1. **Seeds.** GeoNames places (`cities15000`, CC BY 4.0), up to `seeds_per_cell` drawn at
   random from every 10 degree cell with a fixed seed, as in the harvester. Seeds come from the
   gazetteer, never from game photos' locations, so the set is built without looking at the
   answers it will be tested against.
2. **Discover.** Commons geosearch lists files whose camera location is within 10 km of each
   seed. Any geotagged JPEG counts (no quality assessment: retrieval wants many ordinary photos
   rather than a few polished ones). Up to `per_seed` are drawn at random per seed; files that
   are game photos or harvested candidates (`--exclude`) are skipped.
3. **Check.** The same license rules as the game photos (`whereabout_ml.ingest.check_file`:
   CC0, public domain, CC BY, CC BY-SA, an author to credit, no personality-rights tag, camera
   coordinates), recorded per photo for attribution.
4. **Place.** The nearest GeoNames place gives the country (the retrieval searches within
   Atlas's guessed country) and the place name shown when a reference sets Atlas's pin. Files
   more than 150 km from every place are dropped.
   The Commons search stops after `--search-minutes`; seeds are searched in random order, so
   a cut-short search still spreads over the map.
5. **Thumbnails.** 330 px thumbnails are fetched politely until `--budget-minutes` runs out;
   the rest are fetched by later runs, so the set fills in over a few runs without pushing one
   past the runner's time limit.

Rows are ordered round-robin across grid cells, so any prefix of the file covers the map.
If `--out` already exists it is reused as is (no API calls) unless `--refresh` is given, so
reruns are reproducible and only download missing thumbnails.
"""

from __future__ import annotations

import argparse
import csv
import random
import time
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from whereabout_ml.concept_labels import download
from whereabout_ml.gazetteer import City, parse_cities
from whereabout_ml.geocells import haversine_matrix
from whereabout_ml.harvest import (
    GEOSEARCH_LIMIT,
    GEOSEARCH_RADIUS_M,
    PHOTO_EXTENSIONS,
    CommonsApiError,
    Seed,
    pick_seeds,
    polite,
    query_api,
)
from whereabout_ml.ingest import (
    COMMONS_API,
    THUMB_WIDTH,
    Accepted,
    check_file,
    fetch_metadata,
    http_get_json,
    title_from_url,
    write_csv,
)

ID_PREFIX = "wr"  # "wr" + Commons page id
FIELDS = (
    "id",
    "title",
    "lat",
    "lon",
    "country",
    "place",
    "author",
    "license",
    "source_url",
    "thumb_url",
)
MAX_PLACE_KM = 150.0

Http = Callable[[str], Mapping]


@dataclass(frozen=True)
class Settings:
    cell_deg: float = 10.0
    seeds_per_cell: int = 3
    per_seed: int = 8
    seed: int = 1  # not the harvester's seed 0, so the two pick different places
    pause_s: float = 0.2
    search_minutes: float | None = 45.0  # Commons search; thumbnails have their own budget


# --- discovery -------------------------------------------------------------------------------


def geosearch_url(lat: float, lon: float, api_url: str = COMMONS_API) -> str:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "list": "geosearch",
        "gscoord": f"{lat:.5f}|{lon:.5f}",
        "gsradius": str(GEOSEARCH_RADIUS_M),
        "gsnamespace": "6",
        "gslimit": str(GEOSEARCH_LIMIT),
    }
    return f"{api_url}?{urllib.parse.urlencode(params)}"


def files_near(
    seed: Seed, *, http: Http, api_url: str, sleep: Callable[[float], None]
) -> list[str]:
    """Titles of geotagged JPEG files within the geosearch radius of `seed`, nearest first."""
    data = query_api(geosearch_url(seed.lat, seed.lon, api_url), http, sleep=sleep)
    hits = data.get("query", {}).get("geosearch", [])
    return [h["title"] for h in hits if str(h.get("title", "")).lower().endswith(PHOTO_EXTENSIONS)]


def discover(
    seeds: Sequence[Seed],
    per_seed: int,
    exclude: Iterable[str],
    *,
    rng: random.Random,
    http: Http = http_get_json,
    api_url: str = COMMONS_API,
    pause_s: float = 0.0,
    sleep: Callable[[float], None] = time.sleep,
    budget_s: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[list[tuple[str, Seed]], Counter[str]]:
    """Up to `per_seed` random titles near each seed, each title once, excluded ones skipped.

    Seeds are searched in a random order, so a search cut short by `budget_s` still covers
    the whole map, just more thinly.
    """
    skip = set(exclude)
    seen: set[str] = set()
    out: list[tuple[str, Seed]] = []
    stats: Counter[str] = Counter()
    order = list(seeds)
    rng.shuffle(order)
    started = clock()
    for i, s in enumerate(order):
        if budget_s is not None and clock() - started >= budget_s:
            stats["seeds not searched (time budget)"] = len(order) - i
            break
        if i and pause_s:
            sleep(pause_s)
        try:
            titles = files_near(s, http=http, api_url=api_url, sleep=sleep)
        except CommonsApiError as err:
            if not err.transient:
                raise
            stats["seeds skipped (API busy)"] += 1
            continue
        stats["seeds searched"] += 1
        fresh = []
        for t in titles:
            if t in seen:
                continue
            seen.add(t)
            if t in skip:
                stats["game or harvested photos skipped"] += 1
                continue
            fresh.append(t)
        stats["files found"] += len(fresh)
        out += [(t, s) for t in rng.sample(fresh, min(per_seed, len(fresh)))]
    return out, stats


# --- checks and places -----------------------------------------------------------------------


def check_reference(file) -> Accepted | str:
    """The file with its license captured, or why it cannot be a reference photo."""
    if file.mime != "image/jpeg":
        return "not a JPEG photo"
    checked = check_file(file)
    if isinstance(checked, str):
        return checked
    if not file.thumb_url:
        return "no thumbnail"
    return checked


def nearest_places(
    points: Sequence[tuple[float, float]], places: Sequence[City], max_km: float = MAX_PLACE_KM
) -> list[City | None]:
    """The nearest place to each point, or None beyond `max_km`."""
    places = [p for p in places if p.country]
    if not places:
        raise ValueError("no places")
    lat = np.array([p.lat for p in places])
    lon = np.array([p.lon for p in places])
    out: list[City | None] = []
    for start in range(0, len(points), 256):
        batch = points[start : start + 256]
        d = haversine_matrix([p[0] for p in batch], [p[1] for p in batch], lat, lon)
        for row, j in enumerate(d.argmin(axis=1)):
            out.append(places[j] if d[row, j] <= max_km else None)
    return out


def round_robin(rows: Sequence[Mapping[str, str]], key: str = "cell") -> list[dict[str, str]]:
    """Rows interleaved across `key` groups (groups in sorted order, rows in given order)."""
    groups: dict[str, list[Mapping[str, str]]] = defaultdict(list)
    for r in rows:
        groups[r[key]].append(r)
    out: list[dict[str, str]] = []
    depth = 0
    while len(out) < len(rows):
        for g in sorted(groups):
            if depth < len(groups[g]):
                out.append(dict(groups[g][depth]))
        depth += 1
    return out


def collect(
    *,
    places: Sequence[City],
    exclude_titles: Iterable[str],
    settings: Settings | None = None,
    http: Http = http_get_json,
    api_url: str = COMMONS_API,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[list[dict[str, str]], Counter[str]]:
    """Reference rows (FIELDS) and a count per outcome, from the live Commons API or `http`."""
    settings = settings or Settings()
    seeds = pick_seeds(places, settings.cell_deg, settings.seeds_per_cell, settings.seed)
    found, stats = discover(
        seeds,
        settings.per_seed,
        exclude_titles,
        rng=random.Random(settings.seed),
        http=http,
        api_url=api_url,
        pause_s=settings.pause_s,
        sleep=sleep,
        budget_s=None if settings.search_minutes is None else settings.search_minutes * 60,
    )
    files, missing = fetch_metadata(
        [t for t, _ in found], get_json=http, api_url=api_url, thumb_width=THUMB_WIDTH
    )
    stats["missing on Commons"] += len(missing)
    accepted: list[tuple[Accepted, Seed]] = []
    for title, seed in found:
        file = files.get(title)
        if file is None:
            continue
        checked = check_reference(file)
        if isinstance(checked, str):
            stats[f"rejected: {checked.split(':')[0]}"] += 1
            continue
        accepted.append((checked, seed))
    named = nearest_places([(a.lat, a.lon) for a, _ in accepted], places)
    rows = []
    for (a, seed), place in zip(accepted, named, strict=True):
        if place is None:
            stats[f"rejected: more than {MAX_PLACE_KM:.0f} km from every place"] += 1
            continue
        rows.append(
            {
                "id": f"{ID_PREFIX}{a.file.pageid}",
                "title": a.file.title,
                "lat": f"{a.lat:.6f}",
                "lon": f"{a.lon:.6f}",
                "country": place.country.upper(),
                "place": place.name,
                "author": a.author,
                "license": a.license,
                "source_url": a.file.source_url,
                "thumb_url": a.file.thumb_url,
                "cell": seed.cell,
            }
        )
    stats["references"] = len(rows)
    ordered = round_robin(rows)
    for r in ordered:
        del r["cell"]
    return ordered, stats


# --- thumbnails ------------------------------------------------------------------------------


def thumbnail_path(images: Path, ref_id: str) -> Path:
    return images / f"{ref_id}.jpg"


@dataclass(frozen=True)
class Fetched:
    cached: int
    downloaded: int
    unavailable: int
    left: int


def fetch_thumbnails(
    rows: Sequence[Mapping[str, str]],
    images: Path,
    *,
    budget_s: float | None,
    fetch: Callable[[str, Path], bool] = download,
    pause_s: float = 0.2,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> Fetched:
    """Download missing thumbnails in file order until `budget_s` has passed."""
    get = polite(fetch, pause_s, sleep)
    started = clock()
    cached = downloaded = unavailable = left = 0
    for row in rows:
        dest = thumbnail_path(images, row["id"])
        if dest.exists():
            cached += 1
        elif budget_s is not None and clock() - started >= budget_s:
            left += 1
        elif get(row["thumb_url"], dest):
            downloaded += 1
        else:
            unavailable += 1
    return Fetched(cached, downloaded, unavailable, left)


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def excluded_titles(paths: Iterable[Path]) -> set[str]:
    """Commons titles of every row in CSVs with a `source_url` column (game and harvest)."""
    titles: set[str] = set()
    for path in paths:
        for row in read_rows(path):
            url = row.get("source_url", "")
            if url:
                titles.add(title_from_url(url))
    return titles


def main(argv: Sequence[str] | None = None, *, http: Http = http_get_json) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gazetteer", type=Path, required=True, help="dir with GeoNames files")
    ap.add_argument(
        "--exclude",
        type=Path,
        action="append",
        default=[],
        help="CSV with a source_url column whose files must never be references (repeatable)",
    )
    ap.add_argument("--out", type=Path, default=Path("data/reference/references.csv"))
    ap.add_argument("--images", type=Path, default=Path(".cache/references"))
    ap.add_argument("--budget-minutes", type=float, default=None)
    ap.add_argument("--refresh", action="store_true", help="search Commons again")
    defaults = Settings()
    ap.add_argument("--seeds-per-cell", type=int, default=defaults.seeds_per_cell)
    ap.add_argument("--per-seed", type=int, default=defaults.per_seed)
    ap.add_argument("--seed", type=int, default=defaults.seed)
    ap.add_argument("--search-minutes", type=float, default=defaults.search_minutes)
    ap.add_argument("--api-url", default=COMMONS_API)
    args = ap.parse_args(argv)

    if args.out.exists() and not args.refresh:
        rows = read_rows(args.out)
        print(f"reference set: reusing {len(rows)} references from {args.out}")
    else:
        with (args.gazetteer / "cities15000.txt").open(encoding="utf-8") as fh:
            places = parse_cities(fh)
        settings = Settings(
            seeds_per_cell=args.seeds_per_cell,
            per_seed=args.per_seed,
            seed=args.seed,
            search_minutes=args.search_minutes,
        )
        rows, stats = collect(
            places=places,
            exclude_titles=excluded_titles(args.exclude),
            settings=settings,
            http=http,
            api_url=args.api_url,
        )
        write_csv(args.out, FIELDS, rows)
        for key, n in sorted(stats.items()):
            print(f"reference set: {key}: {n}")
    fetched = fetch_thumbnails(
        rows,
        args.images,
        budget_s=None if args.budget_minutes is None else args.budget_minutes * 60,
    )
    print(
        f"reference thumbnails: {fetched.cached} cached, {fetched.downloaded} downloaded, "
        f"{fetched.unavailable} unavailable, {fetched.left} left for a later run"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
