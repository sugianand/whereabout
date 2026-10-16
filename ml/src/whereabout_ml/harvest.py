"""Harvest new game photos from Wikimedia Commons: grid-balanced, checked and AI-screened.

    harvest-commons --gazetteer data/geonames --catalog data/curation/photos.csv \\
        --thresholds data/scene_gate/thresholds.json --out-dir data/harvest \\
        --cache-dir .cache/harvest --target 1000

1. Seeds. The world is cut into `cell_deg` x `cell_deg` latitude/longitude cells. In every cell
   that has GeoNames places (cities15000, CC BY 4.0), a few are drawn at random with a fixed
   seed, so small towns near countryside are as likely as capitals.
2. Discover. Commons geosearch finds files whose camera location is within 10 km of each seed;
   only files assessed by the Commons community as Quality images or Featured pictures are kept,
   at most `candidates_per_cell` per cell (featured first). Titles already in the catalog are
   skipped.
3. Metadata checks. JPEG, at least 1280 px wide (the catalog links a 1280 px rendition) and
   landscape (width >= 1.25 x height), then `ingest.check_file`: an allowed open license, an
   author to credit, no personality-rights tag, camera coordinates.
4. Dedupe. `ingest.ingest` hashes a 330 px thumbnail of every candidate together with the
   catalog's own files. A candidate within pHash distance of a catalog photo is dropped; of two
   near-identical candidates the larger original is kept.
5. Scene gate. CLIP scores each thumbnail with the thresholds calibrated on the hand-reviewed
   catalog (`data/scene_gate/thresholds.json`) and the same CLIP model; a photo that reaches any
   reason's threshold (people, indoor, text, not a photo, a close-up of an animal or plant) is
   rejected.
6. Place. The nearest GeoNames place gives the country and the place name shown at the reveal:
   "Town, Country", or "near Town, Country" when the camera is more than `near_km` away. Photos
   farther than `max_place_km` from every place are dropped (no reliable country).
7. Balance. Photos are added until the catalog would hold `target` photos, each time from the
   cell with the fewest photos so far (catalog photos count), at most `max_per_cell` per cell.

Writes to `--out-dir`: `harvested.csv` (photos.csv columns, ready to append to the catalog),
`manifest.csv` (provenance and gate scores per harvested photo), `rejected.csv` (title, stage,
reason) and `report.json` / `report.md` (counts per stage and reason). Every count comes from
the run; nothing is estimated.
"""

from __future__ import annotations

import argparse
import csv
import heapq
import json
import random
import re
import time
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TypeVar

import numpy as np

from whereabout_ml.concept_labels import download
from whereabout_ml.gazetteer import City, parse_cities, parse_countries
from whereabout_ml.geocells import haversine_matrix
from whereabout_ml.ingest import (
    COMMONS_API,
    CommonsFile,
    check_file,
    fetch_metadata,
    http_get_json,
    ingest,
    thumb_path,
    titles_from_catalog,
    write_csv,
)
from whereabout_ml.scene_gate import REASONS, SceneGate

# Category -> assessment. Both are added by Commons' own assessment templates
# ({{QualityImage}}, {{Assessments|featured=1}}), so membership means a community review.
ASSESSMENTS: dict[str, str] = {
    "Category:Featured pictures on Wikimedia Commons": "featured",
    "Category:Quality images": "quality",
}
GEOSEARCH_RADIUS_M = 10_000  # the API's maximum radius
GEOSEARCH_LIMIT = 500  # the API's maximum for normal clients
IMAGE_WIDTH = 1280  # the rendition the catalog links (see data/curation/README.md)
MIN_ASPECT = 1.25
PHOTO_EXTENSIONS = (".jpg", ".jpeg")
ID_PREFIX = "wh"  # catalog ids of harvested photos: "wh" + Commons page id

CATALOG_FIELDS = (
    "id",
    "image_url",
    "lat",
    "lon",
    "place",
    "country",
    "author",
    "license",
    "source_url",
)
MANIFEST_FIELDS = (
    "id",
    "pageid",
    "title",
    "cell",
    "seed",
    "assessment",
    "width",
    "height",
    "place_km",
    "phash",
    *(f"gate_{r}" for r in REASONS),
)
REJECTED_FIELDS = ("title", "stage", "reason")
STAGES = ("metadata", "ingest", "scene_gate", "place")

Http = Callable[[str], Mapping]

# API error codes that mean "try again later" rather than "this request is wrong". Geosearch runs
# on CirrusSearch, which sheds load with the first one.
TRANSIENT_API_ERRORS = frozenset(
    {"cirrussearch-too-busy-error", "maxlag", "ratelimited", "readonly", "internal_api_error"}
)
API_ATTEMPTS = 5
API_BACKOFF_S = 5.0
T = TypeVar("T")


@dataclass(frozen=True)
class Settings:
    target: int = 1000
    cell_deg: float = 10.0
    # The first run (4 seeds, 12 candidates per cell) harvested 307: discovery was the
    # bottleneck, so search more places per cell and let more of what they find through.
    seeds_per_cell: int = 12
    candidates_per_cell: int = 30
    max_per_cell: int = 15
    near_km: float = 15.0
    max_place_km: float = 150.0
    seed: int = 0
    pause_s: float = 0.3


# --- grid and seeds --------------------------------------------------------------------------


def cell_key(lat: float, lon: float, deg: float) -> str:
    """The grid cell a point falls in, e.g. "r13c19". Rows count up from the South Pole and
    columns east from the antimeridian; lon 180 wraps to the first column."""
    rows = int(round(180 / deg))
    row = min(max(int((lat + 90) // deg), 0), rows - 1)
    col = int(((lon + 180) % 360) // deg)
    return f"r{row}c{col}"


@dataclass(frozen=True)
class Seed:
    name: str
    country: str
    lat: float
    lon: float
    cell: str


def pick_seeds(cities: Iterable[City], deg: float, per_cell: int, seed: int) -> list[Seed]:
    """Up to `per_cell` places drawn at random from every cell, reproducibly for a `seed`."""
    by_cell: dict[str, list[City]] = defaultdict(list)
    for c in cities:
        by_cell[cell_key(c.lat, c.lon, deg)].append(c)
    rng = random.Random(seed)
    seeds: list[Seed] = []
    for key in sorted(by_cell):
        group = sorted(by_cell[key], key=lambda c: (c.name, c.lat, c.lon))
        for c in rng.sample(group, min(per_cell, len(group))):
            seeds.append(Seed(c.name, c.country, c.lat, c.lon, key))
    return seeds


# --- discovery -------------------------------------------------------------------------------


def geosearch_params(lat: float, lon: float) -> dict[str, str]:
    """One request: files near a point, with only the assessment categories listed."""
    return {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "geosearch",
        "ggscoord": f"{lat:.5f}|{lon:.5f}",
        "ggsradius": str(GEOSEARCH_RADIUS_M),
        "ggsnamespace": "6",
        "ggslimit": str(GEOSEARCH_LIMIT),
        "prop": "categories",
        "clcategories": "|".join(sorted(ASSESSMENTS)),
        "cllimit": "max",
    }


class CommonsApiError(RuntimeError):
    def __init__(self, error: Mapping) -> None:
        super().__init__(f"Commons API error: {dict(error)}")
        self.code = str(error.get("code", ""))

    @property
    def transient(self) -> bool:
        return self.code in TRANSIENT_API_ERRORS


def query_api(
    url: str,
    http: Http,
    *,
    attempts: int = API_ATTEMPTS,
    backoff_s: float = API_BACKOFF_S,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping:
    """`http(url)`, retrying with exponential backoff while the API answers with a transient
    error (HTTP-level retries are `http`'s own job). Other API errors raise at once."""
    for attempt in range(attempts):
        data = http(url)
        if "error" not in data:
            return data
        err = CommonsApiError(data["error"])
        if not err.transient or attempt == attempts - 1:
            raise err
        sleep(backoff_s * 2**attempt)
    raise AssertionError("unreachable")


def assessed_near(
    lat: float,
    lon: float,
    *,
    http: Http = http_get_json,
    api_url: str = COMMONS_API,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, str]:
    """{title: assessment} for assessed files near a point. Category lists can be split over
    several responses (`continue`); they are merged, and "featured" wins over "quality"."""
    params = geosearch_params(lat, lon)
    found: dict[str, str] = {}
    while True:
        data = query_api(f"{api_url}?{urllib.parse.urlencode(params)}", http, sleep=sleep)
        for page in data.get("query", {}).get("pages", []):
            for cat in page.get("categories", []):
                grade = ASSESSMENTS.get(cat.get("title", ""))
                if grade and found.get(page["title"]) != "featured":
                    found[page["title"]] = grade
        cont = data.get("continue")
        if not cont:
            return found
        params = {**params, **{k: str(v) for k, v in cont.items()}}


@dataclass(frozen=True)
class Candidate:
    title: str
    assessment: str
    seed: Seed


def discover(
    seeds: Sequence[Seed],
    per_cell: int,
    skip_titles: Iterable[str] = (),
    *,
    http: Http = http_get_json,
    api_url: str = COMMONS_API,
    pause_s: float = 0.0,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[list[Candidate], dict[str, int]]:
    """Assessed files near the seeds, at most `per_cell` per seed cell (featured first, then by
    title). A file near two seeds counts once, for the first seed that found it."""
    skip = set(skip_titles)
    by_cell: dict[str, dict[str, Candidate]] = defaultdict(dict)
    seen: set[str] = set()
    skipped = 0
    failed = 0
    for i, s in enumerate(seeds):
        if i and pause_s:
            sleep(pause_s)
        try:
            near = assessed_near(s.lat, s.lon, http=http, api_url=api_url, sleep=sleep)
        except CommonsApiError as err:
            if not err.transient:
                raise
            failed += 1  # still busy after the retries: skip this seed, keep the run going
            print(f"skipping seed {s.name}, {s.country}: {err}")
            continue
        for title, grade in near.items():
            if title in seen:
                continue
            seen.add(title)
            if title in skip:
                skipped += 1
                continue
            by_cell[s.cell][title] = Candidate(title, grade, s)
    out: list[Candidate] = []
    for key in sorted(by_cell):
        ranked = sorted(by_cell[key].values(), key=lambda c: (c.assessment != "featured", c.title))
        out += ranked[:per_cell]
    stats = {
        "seeds": len(seeds),
        "seeds_skipped_api_busy": failed,
        "cells_with_seeds": len({s.cell for s in seeds}),
        "assessed_files_found": len(seen),
        "already_in_catalog": skipped,
        "candidates": len(out),
    }
    return out, stats


# --- checks ----------------------------------------------------------------------------------


def sized_thumb_url(thumb_url: str, width: int = IMAGE_WIDTH) -> str:
    """The same Commons thumbnail at another width (the API's tracking query string dropped)."""
    parsed = urllib.parse.urlparse(thumb_url)
    path, n = re.subn(r"/\d+px-([^/]+)$", rf"/{width}px-\1", parsed.path)
    if n != 1:
        raise ValueError(f"not a Commons thumbnail URL: {thumb_url}")
    return urllib.parse.urlunparse(parsed._replace(path=path, query="", fragment=""))


def check_candidate(file: CommonsFile) -> str | None:
    """The reason a Commons file cannot be a game photo, or None if it passes."""
    if not file.title.lower().endswith(PHOTO_EXTENSIONS) or file.mime != "image/jpeg":
        return "not a JPEG photo"
    if file.width < IMAGE_WIDTH:
        return f"narrower than {IMAGE_WIDTH} px"
    if file.width < MIN_ASPECT * file.height:
        return "not landscape"
    checked = check_file(file)
    if isinstance(checked, str):
        return checked
    try:
        sized_thumb_url(file.thumb_url)
    except ValueError:
        return "no thumbnail rendition"
    return None


# --- place names -----------------------------------------------------------------------------


class PlaceNamer:
    """Nearest GeoNames place to a point, as (place name, country code, km), or None if every
    place is farther than `max_km`. Borders are approximate near frontiers."""

    def __init__(
        self,
        places: Iterable[City],
        country_names: Mapping[str, str],
        *,
        near_km: float,
        max_km: float,
        chunk: int = 256,
    ) -> None:
        self.places = [p for p in places if p.country]
        if not self.places:
            raise ValueError("no places to name against")
        self._lat = np.array([p.lat for p in self.places])
        self._lon = np.array([p.lon for p in self.places])
        self.country_names = dict(country_names)
        self.near_km, self.max_km, self._chunk = near_km, max_km, chunk

    def name(self, points: Sequence[tuple[float, float]]) -> list[tuple[str, str, float] | None]:
        out: list[tuple[str, str, float] | None] = []
        for start in range(0, len(points), self._chunk):
            batch = points[start : start + self._chunk]
            d = haversine_matrix([p[0] for p in batch], [p[1] for p in batch], self._lat, self._lon)
            for row, j in enumerate(d.argmin(axis=1)):
                km = float(d[row, j])
                if km > self.max_km:
                    out.append(None)
                    continue
                place = self.places[j]
                country = place.country.upper()
                label = f"{place.name}, {self.country_names.get(country, country)}"
                out.append((f"near {label}" if km > self.near_km else label, country, km))
        return out


# --- balance ---------------------------------------------------------------------------------


def balance(
    pool: Mapping[str, Sequence[T]], already: Mapping[str, int], n: int, max_per_cell: int
) -> list[T]:
    """Take up to `n` items, always from the cell with the fewest so far (`already` counts what
    each cell holds before; ties by cell key), never more than `max_per_cell` in a cell. Within
    a cell, items are taken in the order given."""
    heap = [(already.get(c, 0), c) for c in sorted(pool) if pool[c]]
    heapq.heapify(heap)
    taken = dict.fromkeys(pool, 0)
    out: list[T] = []
    while heap and len(out) < n:
        count, c = heapq.heappop(heap)
        if count >= max_per_cell:
            break  # the emptiest cell is full, so every cell is
        out.append(pool[c][taken[c]])
        taken[c] += 1
        if taken[c] < len(pool[c]):
            heapq.heappush(heap, (count + 1, c))
    return out


def polite(
    fetch: Callable[[str, Path], bool], pause_s: float, sleep: Callable[[float], None]
) -> Callable[[str, Path], bool]:
    """`fetch` with a pause after each download, and a thumbnail that still fails after the
    download's own retries counted as unavailable instead of ending a long run."""

    def go(url: str, dest: Path) -> bool:
        try:
            return fetch(url, dest)
        except RuntimeError as err:
            print(f"thumbnail unavailable: {err}")
            return False
        finally:
            if pause_s:
                sleep(pause_s)

    return go


# --- pipeline --------------------------------------------------------------------------------


@dataclass
class HarvestResult:
    photos: list[dict[str, str]] = field(default_factory=list)
    manifest: list[dict[str, str]] = field(default_factory=list)
    rejected: list[dict[str, str]] = field(default_factory=list)
    report: dict = field(default_factory=dict)

    def reject(self, title: str, stage: str, reason: str) -> None:
        self.rejected.append({"title": title, "stage": stage, "reason": reason})


def _reason_key(reason: str) -> str:
    """Group "license not allowed: CC BY-NC 4.0" with the other license rejections."""
    return reason.split(":")[0]


def harvest(
    *,
    places: Sequence[City],
    country_names: Mapping[str, str],
    catalog_titles: Sequence[str],
    catalog_points: Sequence[tuple[float, float]],
    thresholds: Mapping[str, float],
    encoder,
    cache_dir: Path,
    settings: Settings | None = None,
    http: Http = http_get_json,
    fetch: Callable[[str, Path], bool] = download,
    api_url: str = COMMONS_API,
    sleep: Callable[[float], None] = time.sleep,
) -> HarvestResult:
    """Run the seven steps in the module docstring and return what to write."""
    s = settings or Settings()
    result = HarvestResult()
    seeds = pick_seeds(places, s.cell_deg, s.seeds_per_cell, s.seed)
    candidates, discovery = discover(
        seeds,
        s.candidates_per_cell,
        catalog_titles,
        http=http,
        api_url=api_url,
        pause_s=s.pause_s,
        sleep=sleep,
    )
    print(f"discovered {len(candidates)} candidates from {len(seeds)} seeds")
    by_title = {c.title: c for c in candidates}

    # 3. Metadata checks, before any thumbnail is downloaded.
    files, missing = fetch_metadata(list(by_title), get_json=http, api_url=api_url)
    for t in missing:
        result.reject(t, "metadata", "not found on Commons")
    passed: list[str] = []
    for title in by_title:
        if title not in files:
            continue
        reason = check_candidate(files[title])
        if reason:
            result.reject(title, "metadata", reason)
        else:
            passed.append(title)

    # 4. Hash with the catalog's files and drop near-duplicates.
    ingested = ingest(
        [*catalog_titles, *passed],
        cache_dir,
        get_json=http,
        fetch=polite(fetch, s.pause_s, sleep),
        api_url=api_url,
    )
    passed_set = set(passed)
    for r in ingested.rejected:
        if r["title"] in passed_set:
            result.reject(r["title"], "ingest", r["reason"])
    rows = {r["pageid"]: r for r in ingested.rows}
    is_candidate = {k: r["title"] in passed_set for k, r in rows.items()}
    dropped: dict[str, str] = {}
    for key, r in rows.items():
        of = r["duplicate_of"]
        if not of:
            continue
        if is_candidate[key] and not is_candidate[of]:
            dropped[key] = "near-duplicate of a catalog photo"
        elif not is_candidate[key] and is_candidate[of]:
            dropped[of] = "near-duplicate of a catalog photo"
        elif is_candidate[key]:
            dropped.setdefault(key, "near-duplicate of another candidate")
    for key, reason in dropped.items():
        result.reject(rows[key]["title"], "ingest", reason)
    unique = [
        r for k, r in rows.items() if is_candidate[k] and k not in dropped and not r["duplicate_of"]
    ]

    # 5. Scene gate on the cached thumbnails.
    gate = SceneGate(encoder, thresholds)
    paths = [thumb_path(cache_dir, r["pageid"], r["thumb_url"]) for r in unique]
    scores = gate.score_embeddings(encoder.encode_images(paths)) if unique else []
    gate_counts = dict.fromkeys(REASONS, 0)
    screened: list[tuple[dict[str, str], dict[str, float]]] = []
    for r, sc in zip(unique, scores, strict=True):
        verdict = gate.judge(sc)
        for reason in verdict.reasons:
            gate_counts[reason] += 1
        if verdict.passed:
            screened.append((r, sc))
        else:
            result.reject(r["title"], "scene_gate", "scene gate: " + ", ".join(verdict.reasons))

    # 6. Place and country.
    namer = PlaceNamer(places, country_names, near_km=s.near_km, max_km=s.max_place_km)
    named = namer.name([(float(r["lat"]), float(r["lon"])) for r, _ in screened])
    pool: dict[str, list[tuple[dict[str, str], dict[str, float], tuple[str, str, float]]]] = (
        defaultdict(list)
    )
    for (r, sc), where in zip(screened, named, strict=True):
        if where is None:
            result.reject(r["title"], "place", f"farther than {s.max_place_km:g} km from a place")
            continue
        pool[cell_key(float(r["lat"]), float(r["lon"]), s.cell_deg)].append((r, sc, where))

    # 7. Balance across cells, best first within a cell.
    for items in pool.values():
        items.sort(
            key=lambda it: (
                by_title[it[0]["title"]].assessment != "featured",
                -int(it[0]["width"]) * int(it[0]["height"]),
                int(it[0]["pageid"]),
            )
        )
    already = Counter(cell_key(lat, lon, s.cell_deg) for lat, lon in catalog_points)
    room = max(s.target - len(catalog_points), 0)
    chosen = balance(pool, already, room, s.max_per_cell)

    for r, sc, (place, country, km) in sorted(chosen, key=lambda it: int(it[0]["pageid"])):
        photo_id = f"{ID_PREFIX}{r['pageid']}"
        result.photos.append(
            {
                "id": photo_id,
                "image_url": sized_thumb_url(r["thumb_url"]),
                "lat": r["lat"],
                "lon": r["lon"],
                "place": place,
                "country": country,
                "author": r["author"],
                "license": r["license"],
                "source_url": r["source_url"],
            }
        )
        cand = by_title[r["title"]]
        result.manifest.append(
            {
                "id": photo_id,
                "pageid": r["pageid"],
                "title": r["title"],
                "cell": cell_key(float(r["lat"]), float(r["lon"]), s.cell_deg),
                "seed": f"{cand.seed.name}, {cand.seed.country}",
                "assessment": cand.assessment,
                "width": r["width"],
                "height": r["height"],
                "place_km": f"{km:.1f}",
                "phash": r["phash"],
                **{f"gate_{k}": f"{sc[k]:.3f}" for k in REASONS},
            }
        )

    by_stage: dict[str, Counter] = {stage: Counter() for stage in STAGES}
    for r in result.rejected:
        by_stage[r["stage"]][_reason_key(r["reason"])] += 1
    cells = Counter(m["cell"] for m in result.manifest) + already
    result.report = {
        "settings": asdict(s),
        "discovery": discovery,
        "rejected_by_stage": {stage: dict(sorted(c.items())) for stage, c in by_stage.items() if c},
        "scene_gate": {
            "screened": len(unique),
            "passed": len(screened),
            "rejected": len(unique) - len(screened),
            "rejected_by_reason": gate_counts,
            "thresholds": dict(thresholds),
            "model": getattr(encoder, "name", ""),
        },
        "passed_all_checks": sum(len(v) for v in pool.values()),
        "harvested": len(result.photos),
        "catalog_before": len(catalog_points),
        "catalog_after": len(catalog_points) + len(result.photos),
        "cells_after": len(cells),
        "countries_harvested": len({p["country"] for p in result.photos}),
        "assessments": dict(sorted(Counter(m["assessment"] for m in result.manifest).items())),
        "licenses": dict(sorted(Counter(p["license"] for p in result.photos).items())),
        "sources": {
            "photos": "Wikimedia Commons API (geosearch, categories, imageinfo + extmetadata)",
            "places": "GeoNames cities15000 and countryInfo (CC BY 4.0)",
        },
    }
    return result


def to_markdown(report: Mapping) -> str:
    d, g = report["discovery"], report["scene_gate"]
    lines = [
        "# Commons harvest",
        "",
        f"Harvested {report['harvested']} photos; the catalog would grow from "
        f"{report['catalog_before']} to {report['catalog_after']} photos across "
        f"{report['cells_after']} grid cells "
        f"({report['settings']['cell_deg']:g} degree cells).",
        "",
        "## Funnel",
        "",
        "| Step | Count |",
        "| --- | ---: |",
        f"| Seed places searched | {d['seeds']} (in {d['cells_with_seeds']} cells) |",
        f"| Seeds skipped (search still busy after retries) | {d['seeds_skipped_api_busy']} |",
        f"| Assessed files found (Quality or Featured) | {d['assessed_files_found']} |",
        f"| Already in the catalog | {d['already_in_catalog']} |",
        f"| Candidates after the per-cell cap | {d['candidates']} |",
        f"| Screened by the scene gate | {g['screened']} |",
        f"| Passed the scene gate | {g['passed']} |",
        f"| Passed every check | {report['passed_all_checks']} |",
        f"| Harvested after grid balancing | {report['harvested']} |",
        "",
        "## Rejections",
        "",
        "| Stage | Reason | Photos |",
        "| --- | --- | ---: |",
    ]
    for stage, reasons in report["rejected_by_stage"].items():
        for reason, n in reasons.items():
            lines.append(f"| {stage} | {reason} | {n} |")
    lines += [
        "",
        "A photo can reach more than one scene-gate threshold, so the per-reason counts below can "
        "add up to more than the photos the gate rejected.",
        "",
        "| Scene-gate reason | Threshold (log-odds) | Photos at or above it |",
        "| --- | ---: | ---: |",
    ]
    for r in REASONS:
        lines.append(f"| {r} | {g['thresholds'][r]} | {g['rejected_by_reason'][r]} |")
    lines += ["", f"Scene-gate model: {g['model'] or 'unknown'}.", ""]
    return "\n".join(lines)


def write_outputs(result: HarvestResult, out_dir: Path) -> None:
    write_csv(out_dir / "harvested.csv", CATALOG_FIELDS, result.photos)
    write_csv(out_dir / "manifest.csv", MANIFEST_FIELDS, result.manifest)
    write_csv(
        out_dir / "rejected.csv",
        REJECTED_FIELDS,
        sorted(result.rejected, key=lambda r: (STAGES.index(r["stage"]), r["title"])),
    )
    (out_dir / "report.json").write_text(
        json.dumps(result.report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (out_dir / "report.md").write_text(to_markdown(result.report), encoding="utf-8")


def missing_reasons(path: Path) -> list[str]:
    """Scene-gate reasons with no calibrated threshold in `path` (all of them if it is absent).

    A reason added to the gate has no threshold until the Scene gate workflow recalibrates, and
    a harvest screened without it would let those photos through."""
    if not path.exists():
        return list(REASONS)
    have = json.loads(path.read_text(encoding="utf-8")).get("thresholds", {})
    return [r for r in REASONS if r not in have]


def load_thresholds(path: Path) -> tuple[dict[str, float], tuple[str, str]]:
    """Thresholds and the (model, pretrained) pair they were calibrated with."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("score") != "log-odds":
        raise ValueError(f"{path}: expected log-odds thresholds, got {data.get('score')!r}")
    name, sep, pretrained = str(data.get("model", "")).partition("/")
    if not sep:
        raise ValueError(f"{path}: no calibration model recorded")
    missing = missing_reasons(path)
    if missing:
        raise ValueError(f"{path}: no threshold for {missing}; recalibrate the scene gate first")
    return {r: float(data["thresholds"][r]) for r in REASONS}, (name, pretrained)


def read_catalog(path: Path) -> tuple[list[str], list[tuple[float, float]]]:
    with path.open(newline="", encoding="utf-8") as fh:
        points = [(float(r["lat"]), float(r["lon"])) for r in csv.DictReader(fh)]
    return titles_from_catalog(path), points


def main(argv: Sequence[str] | None = None, encoder_factory=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gazetteer", type=Path, help="dir with GeoNames files")
    ap.add_argument("--catalog", type=Path, default=Path("data/curation/photos.csv"))
    ap.add_argument("--thresholds", type=Path, default=Path("data/scene_gate/thresholds.json"))
    ap.add_argument(
        "--check-thresholds",
        action="store_true",
        help="only check that --thresholds covers every scene-gate reason (exit 2 if not)",
    )
    ap.add_argument("--out-dir", type=Path, default=Path("data/harvest"))
    ap.add_argument("--cache-dir", type=Path, default=Path(".cache/harvest"))
    defaults = Settings()
    for name, value in asdict(defaults).items():
        ap.add_argument(f"--{name.replace('_', '-')}", type=type(value), default=value)
    ap.add_argument("--api-url", default=COMMONS_API)
    args = ap.parse_args(argv)
    if args.check_thresholds:
        missing = missing_reasons(args.thresholds)
        print(f"no threshold yet for {missing}" if missing else "every reason has a threshold")
        return 2 if missing else 0
    if args.gazetteer is None:
        ap.error("--gazetteer is required")
    settings = Settings(**{k: getattr(args, k) for k in asdict(defaults)})

    with (args.gazetteer / "countryInfo.txt").open(encoding="utf-8") as fh:
        country_names = {c.code: c.name for c in parse_countries(fh)}
    with (args.gazetteer / "cities15000.txt").open(encoding="utf-8") as fh:
        places = parse_cities(fh)
    thresholds, model = load_thresholds(args.thresholds)
    titles, points = read_catalog(args.catalog)

    if encoder_factory is None:
        from whereabout_ml.clip_encoder import ClipEncoder as encoder_factory

    result = harvest(
        places=places,
        country_names=country_names,
        catalog_titles=titles,
        catalog_points=points,
        thresholds=thresholds,
        encoder=encoder_factory(*model),
        cache_dir=args.cache_dir,
        settings=settings,
        api_url=args.api_url,
    )
    write_outputs(result, args.out_dir)
    print(to_markdown(result.report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
