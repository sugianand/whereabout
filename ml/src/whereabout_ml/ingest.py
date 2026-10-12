"""Ingest image metadata from Wikimedia Commons: capture licenses, drop near-duplicates.

Training data has to arrive with its license and attribution attached, and the same photo
uploaded twice (or re-cropped, re-encoded, resized) must not end up on both sides of a
train/validation split. This module turns a list of Commons file titles into a manifest:

    ingest-commons --catalog data/curation/photos.csv --out-dir data/ingest \\
        --name sample --cache-dir .cache/ingest

1. Metadata: ask the Commons API for each file's size, SHA-1, camera coordinates and
   `extmetadata` (license, author, restrictions), 50 titles per request.
2. License capture: normalise the license to the allow-list (CC0, public domain, CC BY,
   CC BY-SA). Anything else (NC, ND, GFDL-only, unknown) is rejected with a reason, as are files
   without coordinates and files tagged with personality rights (identifiable people).
3. Perceptual hash: download a small thumbnail and compute a 64-bit DCT hash (pHash). Two
   images within `max_distance` bits of each other are treated as the same photo; the larger
   original is kept and the other is recorded with `duplicate_of`.

Outputs `<name>_manifest.csv` (kept and duplicate files), `<name>_rejected.csv` (title,
reason) and `<name>_manifest.meta.json` (counts, settings, and, when the input is the curated
catalog, where the captured license disagrees with the hand-curated one).
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

import numpy as np

from whereabout_ml.concept_labels import USER_AGENT, download

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia serves a fixed set of thumbnail widths; 330 px is one of them and plenty for a hash.
THUMB_WIDTH = 330
BATCH = 50  # the API's limit on titles per query for normal clients
# Bits out of 64. Re-encoding and resizing move a pHash by a few bits; different photos of the
# same kind of scene are typically 20+ apart. 8 is a common, conservative cut-off.
MAX_DISTANCE = 8
EXTMETADATA = (
    "LicenseShortName",
    "LicenseUrl",
    "Artist",
    "GPSLatitude",
    "GPSLongitude",
    "AttributionRequired",
    "Restrictions",
)

MANIFEST_FIELDS = (
    "pageid",
    "title",
    "source_url",
    "thumb_url",
    "width",
    "height",
    "lat",
    "lon",
    "author",
    "license",
    "license_url",
    "attribution_required",
    "sha1",
    "phash",
    "duplicate_of",
    "distance",
)
REJECTED_FIELDS = ("title", "reason")


# --- license capture -------------------------------------------------------------------------

_CC = re.compile(r"^cc[ -]by(?P<sa>[ -]sa)?[ -](?P<ver>\d\.\d)(?:[ -](?P<port>[a-z]{2,3}))?$")
_CC0 = re.compile(r"^cc[ -]?0(?:[ -]1\.0)?$|^cc[ -]zero$")
_PD = re.compile(r"^(public[ -]domain|pd(?:[ -].*)?)$")


def normalize_license(short_name: str) -> str | None:
    """The canonical name of an allowed license, or None if the license is not allowed.

    Allowed: "CC0", "Public domain", "CC BY x.y" and "CC BY-SA x.y" (with a jurisdiction port
    such as "ca" kept, as Commons writes it). NC and ND variants never match.
    """
    s = " ".join(short_name.strip().lower().split())
    if not s:
        return None
    if _CC0.match(s):
        return "CC0"
    if _PD.match(s):
        return "Public domain"
    m = _CC.match(s)
    if m:
        name = f"CC BY{'-SA' if m['sa'] else ''} {m['ver']}"
        return f"{name} {m['port']}" if m["port"] else name
    return None


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(value: str) -> str:
    """Commons' `Artist` field is HTML (often a user-page link); credit needs the plain text."""
    parser = _TextOnly()
    parser.feed(value)
    parser.close()
    return " ".join(html.unescape("".join(parser.parts)).split())


# --- Commons metadata ------------------------------------------------------------------------


@dataclass(frozen=True)
class CommonsFile:
    """One Commons file as the API describes it, before any checks."""

    pageid: int
    title: str
    source_url: str
    thumb_url: str
    width: int
    height: int
    mime: str
    sha1: str
    meta: Mapping[str, str]

    @property
    def pixels(self) -> int:
        return self.width * self.height


def parse_page(page: Mapping) -> CommonsFile | None:
    """A `formatversion=2` query page, or None if the file is missing or has no image info."""
    if page.get("missing") or page.get("invalid") or not page.get("imageinfo"):
        return None
    info = page["imageinfo"][0]
    meta = {k: str(v.get("value", "")) for k, v in (info.get("extmetadata") or {}).items()}
    return CommonsFile(
        pageid=int(page["pageid"]),
        title=str(page["title"]),
        source_url=str(info.get("descriptionurl", "")),
        thumb_url=str(info.get("thumburl") or info.get("url", "")),
        width=int(info.get("width", 0)),
        height=int(info.get("height", 0)),
        mime=str(info.get("mime", "")),
        sha1=str(info.get("sha1", "")),
        meta=meta,
    )


def query_url(titles: Sequence[str], api_url: str, thumb_width: int) -> str:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "imageinfo",
        "iiprop": "url|size|sha1|mime|extmetadata",
        "iiextmetadatafilter": "|".join(EXTMETADATA),
        "iiurlwidth": str(thumb_width),
        "titles": "|".join(titles),
    }
    return f"{api_url}?{urllib.parse.urlencode(params)}"


def http_get_json(url: str, *, attempts: int = 4, backoff_s: float = 2.0) -> dict:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code not in (429, 500, 502, 503, 504):
                raise
            last = err
        except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
            last = err
        time.sleep(backoff_s * 2**attempt)
    raise RuntimeError(f"gave up on {url} after {attempts} attempts: {last}")


def fetch_metadata(
    titles: Sequence[str],
    *,
    get_json: Callable[[str], Mapping] = http_get_json,
    api_url: str = COMMONS_API,
    thumb_width: int = THUMB_WIDTH,
) -> tuple[dict[str, CommonsFile], list[str]]:
    """Look up `titles` in batches. Returns ({input title: file}, [titles Commons lacks])."""
    found: dict[str, CommonsFile] = {}
    missing: list[str] = []
    for start in range(0, len(titles), BATCH):
        batch = list(titles[start : start + BATCH])
        query = get_json(query_url(batch, api_url, thumb_width)).get("query", {})
        # The API answers under canonical titles; map them back to what we asked for.
        canonical = {t: t for t in batch}
        for n in query.get("normalized", []):
            canonical[n["from"]] = n["to"]
        pages = {p.get("title"): parse_page(p) for p in query.get("pages", [])}
        for title in batch:
            file = pages.get(canonical[title])
            if file is None:
                missing.append(title)
            else:
                found[title] = file
    return found, missing


def titles_from_catalog(path: Path) -> list[str]:
    """Commons titles ("File:...") from the catalog's `source_url` column."""
    with path.open(newline="", encoding="utf-8") as fh:
        urls = [row["source_url"] for row in csv.DictReader(fh)]
    return [title_from_url(u) for u in urls]


def title_from_url(url: str) -> str:
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    marker = "/wiki/"
    if marker not in path:
        raise ValueError(f"not a Commons file page: {url}")
    return path.split(marker, 1)[1].replace("_", " ")


# --- checks ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Accepted:
    file: CommonsFile
    lat: float
    lon: float
    author: str
    license: str


def _coordinate(value: str, limit: float) -> float | None:
    try:
        x = float(value)
    except ValueError:
        return None
    return x if math.isfinite(x) and -limit <= x <= limit else None


def check_file(file: CommonsFile) -> Accepted | str:
    """The file with its captured license, or the reason it cannot be used."""
    if not file.mime.startswith("image/") or file.mime == "image/svg+xml":
        return f"not a photo ({file.mime or 'unknown type'})"
    short = file.meta.get("LicenseShortName", "")
    license_ = normalize_license(short)
    if license_ is None:
        return f"license not allowed: {short or 'none given'}"
    author = html_to_text(file.meta.get("Artist", ""))
    if not author and license_ not in ("CC0", "Public domain"):
        return "no author to credit"
    restrictions = {r.strip().lower() for r in file.meta.get("Restrictions", "").split("|")}
    if "personality" in restrictions:
        return "personality rights (identifiable people)"
    lat = _coordinate(file.meta.get("GPSLatitude", ""), 90)
    lon = _coordinate(file.meta.get("GPSLongitude", ""), 180)
    if lat is None or lon is None:
        return "no camera coordinates"
    return Accepted(file, lat, lon, author, license_)


# --- perceptual hash -------------------------------------------------------------------------


def _dct_matrix(n: int) -> np.ndarray:
    """Orthonormal DCT-II basis: `D @ x` transforms a length-n signal."""
    k = np.arange(n)[:, None]
    i = np.arange(n)[None, :]
    d = np.cos(np.pi * (2 * i + 1) * k / (2 * n)) * math.sqrt(2 / n)
    d[0] /= math.sqrt(2)
    return d


def phash(image, hash_size: int = 8, oversample: int = 4) -> int:
    """64-bit perceptual hash of a PIL image (DCT hash, as in pHash / imagehash).

    Shrink to 32×32 grey, take the 2-D DCT, keep the 8×8 lowest frequencies and set one bit per
    coefficient above their median (the DC term, i.e. overall brightness, is left out of the
    median). Low frequencies survive resizing, recompression and small colour shifts.
    """
    from PIL import Image, ImageOps

    n = hash_size * oversample
    grey = ImageOps.exif_transpose(image).convert("L").resize((n, n), Image.Resampling.LANCZOS)
    d = _dct_matrix(n)
    coeffs = d @ np.asarray(grey, dtype=np.float64) @ d.T
    low = coeffs[:hash_size, :hash_size].ravel()
    bits = low > np.median(low[1:])
    return int("".join("1" if b else "0" for b in bits), 2)


def phash_file(path: Path) -> int:
    from PIL import Image

    with Image.open(path) as im:
        return phash(im)


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


@dataclass(frozen=True)
class Hashed:
    key: str
    phash: int
    pixels: int


@dataclass(frozen=True)
class Duplicate:
    key: str
    of: str
    distance: int


def dedupe(items: Sequence[Hashed], max_distance: int = MAX_DISTANCE) -> list[Duplicate]:
    """Near-duplicates among `items`; every other item is kept.

    Greedy: visit items largest first (ties by input order), so the best copy of a photo is the
    one kept; an item within `max_distance` of an already kept one is a duplicate of the closest
    such item, otherwise it is kept. Matching only against kept items means a chain A~B~C does
    not make A and C duplicates unless they are close themselves.
    """
    order = sorted(range(len(items)), key=lambda i: (-items[i].pixels, i))
    kept: list[Hashed] = []
    dups: list[Duplicate] = []
    for i in order:
        item = items[i]
        best = min(
            ((hamming(item.phash, k.phash), j) for j, k in enumerate(kept)),
            default=None,
        )
        if best is not None and best[0] <= max_distance:
            dups.append(Duplicate(item.key, kept[best[1]].key, best[0]))
        else:
            kept.append(item)
    return dups


# --- pipeline --------------------------------------------------------------------------------


@dataclass
class IngestResult:
    rows: list[dict[str, str]] = field(default_factory=list)
    rejected: list[dict[str, str]] = field(default_factory=list)

    @property
    def kept(self) -> list[dict[str, str]]:
        return [r for r in self.rows if not r["duplicate_of"]]

    @property
    def duplicates(self) -> list[dict[str, str]]:
        return [r for r in self.rows if r["duplicate_of"]]


def ingest(
    titles: Iterable[str],
    cache_dir: Path,
    *,
    get_json: Callable[[str], Mapping] = http_get_json,
    fetch: Callable[[str, Path], bool] = download,
    api_url: str = COMMONS_API,
    thumb_width: int = THUMB_WIDTH,
    max_distance: int = MAX_DISTANCE,
) -> IngestResult:
    """Run metadata → license and coordinate checks → thumbnail pHash → dedupe."""
    unique = list(dict.fromkeys(titles))
    result = IngestResult()
    files, missing = fetch_metadata(
        unique, get_json=get_json, api_url=api_url, thumb_width=thumb_width
    )
    result.rejected.extend({"title": t, "reason": "not found on Commons"} for t in missing)

    accepted: list[Accepted] = []
    seen_pages: set[int] = set()
    for title in unique:
        file = files.get(title)
        if file is None:
            continue
        if file.pageid in seen_pages:  # two input titles redirect to one file
            result.rejected.append({"title": title, "reason": "same file as another title"})
            continue
        seen_pages.add(file.pageid)
        checked = check_file(file)
        if isinstance(checked, str):
            result.rejected.append({"title": title, "reason": checked})
        else:
            accepted.append(checked)

    hashed: dict[str, tuple[Accepted, int]] = {}
    for i, a in enumerate(accepted, start=1):
        suffix = Path(urllib.parse.urlparse(a.file.thumb_url).path).suffix.lower() or ".img"
        path = cache_dir / f"{a.file.pageid}{suffix}"
        if not path.exists() and not fetch(a.file.thumb_url, path):
            result.rejected.append({"title": a.file.title, "reason": "thumbnail not available"})
            continue
        try:
            h = phash_file(path)
        except OSError as err:  # PIL.UnidentifiedImageError is an OSError
            result.rejected.append({"title": a.file.title, "reason": f"unreadable image: {err}"})
            continue
        hashed[str(a.file.pageid)] = (a, h)
        if i % 25 == 0 or i == len(accepted):
            print(f"hashed {i}/{len(accepted)}")

    dups = {
        d.key: d
        for d in dedupe([Hashed(k, h, a.file.pixels) for k, (a, h) in hashed.items()], max_distance)
    }
    for key, (a, h) in hashed.items():
        dup = dups.get(key)
        f = a.file
        result.rows.append(
            {
                "pageid": key,
                "title": f.title,
                "source_url": f.source_url,
                "thumb_url": f.thumb_url,
                "width": str(f.width),
                "height": str(f.height),
                "lat": f"{a.lat:.6f}",
                "lon": f"{a.lon:.6f}",
                "author": a.author,
                "license": a.license,
                "license_url": f.meta.get("LicenseUrl", ""),
                "attribution_required": f.meta.get("AttributionRequired", ""),
                "sha1": f.sha1,
                "phash": f"{h:016x}",
                "duplicate_of": dup.of if dup else "",
                "distance": str(dup.distance) if dup else "",
            }
        )
    return result


def catalog_license_mismatches(
    catalog: Path, rows: Sequence[Mapping[str, str]]
) -> list[dict[str, str]]:
    """Catalog photos whose curated license differs from the one captured from Commons."""
    captured = {r["title"]: r["license"] for r in rows}
    out = []
    with catalog.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            title = title_from_url(row["source_url"])
            if title in captured and captured[title] != row["license"]:
                out.append(
                    {"id": row["id"], "curated": row["license"], "captured": captured[title]}
                )
    return out


def write_csv(path: Path, fields: Sequence[str], rows: Iterable[Mapping[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def summary(result: IngestResult, n_titles: int, max_distance: int) -> dict[str, object]:
    return {
        "titles": n_titles,
        "kept": len(result.kept),
        "duplicates": len(result.duplicates),
        "rejected": len(result.rejected),
        "rejected_by_reason": dict(
            sorted(Counter(r["reason"].split(":")[0] for r in result.rejected).items())
        ),
        "licenses": dict(sorted(Counter(r["license"] for r in result.rows).items())),
        "phash": {"bits": 64, "max_distance": max_distance, "thumb_width": THUMB_WIDTH},
        "source": "Wikimedia Commons API (imageinfo + extmetadata)",
    }


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    src = ap.add_argument_group("input (at least one)")
    src.add_argument("--catalog", type=Path, help="take titles from a catalog's source_url")
    src.add_argument("--titles", type=Path, help="a text file of Commons titles, one per line")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--name", default="sample", help="output file prefix")
    ap.add_argument("--cache-dir", type=Path, default=Path(".cache/ingest"))
    ap.add_argument("--max-distance", type=int, default=MAX_DISTANCE)
    ap.add_argument("--api-url", default=COMMONS_API)
    args = ap.parse_args(argv)
    if not args.catalog and not args.titles:
        ap.error("give --catalog, --titles or both")

    titles: list[str] = []
    if args.catalog:
        titles += titles_from_catalog(args.catalog)
    if args.titles:
        lines = args.titles.read_text(encoding="utf-8").splitlines()
        titles += [t.strip() for t in lines if t.strip() and not t.startswith("#")]
    titles = list(dict.fromkeys(titles))

    result = ingest(
        titles,
        args.cache_dir,
        get_json=http_get_json,
        api_url=args.api_url,
        max_distance=args.max_distance,
    )
    manifest = args.out_dir / f"{args.name}_manifest.csv"
    write_csv(manifest, MANIFEST_FIELDS, sorted(result.rows, key=lambda r: int(r["pageid"])))
    write_csv(
        args.out_dir / f"{args.name}_rejected.csv",
        REJECTED_FIELDS,
        sorted(result.rejected, key=lambda r: r["title"]),
    )
    meta = summary(result, len(titles), args.max_distance)
    if args.catalog:
        meta["catalog_license_mismatches"] = catalog_license_mismatches(args.catalog, result.rows)
    meta_path = manifest.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
