"""Postcards: one thing to learn about each catalog photo's place, fetched from Wikimedia.

For every photo in the catalog this finds

- **a short description**: the English description on the photo's own Commons file page
  (`ImageDescription`), as plain text, trimmed to a sentence or two. A description with no
  language tag is kept only when it reads as English. Descriptions that only repeat the file
  name, or are too short to say anything, are dropped.
- **a Wikipedia article** (English) about what the photo shows, found two ways, in order:
  1. *depicts*: the file's structured data names what it depicts (Commons MediaInfo, P180).
     The first depicted Wikidata item that has an English Wikipedia article **and** a
     coordinate (P625) within `DEPICTS_KM` of the camera is used. Items with no coordinate
     ("mountain", "sky") are general concepts, not this place, and are skipped.
  2. *place*: otherwise the parts of the catalog's place name ("Saal an der Saale, Bavaria,
     Germany" -> "Saal an der Saale", "Bavaria") are looked up as English Wikipedia titles,
     following redirects, and the first whose article coordinates lie within `PLACE_KM` of the
     camera is used. The country, the last part, is never used: it teaches nothing new.

Nothing is guessed: a photo with neither a usable description nor a nearby article gets no row.
Commons and Wikipedia cannot be reached from every sandbox, so the Postcards workflow
(`.github/workflows/postcards.yml`) runs this in CI and commits `data/postcards/postcards.csv`.

Run: postcards --catalog data/curation/photos.csv --out data/postcards/postcards.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import time
import urllib.parse
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from whereabout_ml.ingest import BATCH, COMMONS_API, html_to_text, http_get_json, title_from_url

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
ENWIKI_API = "https://en.wikipedia.org/w/api.php"
ENWIKI_PAGE = "https://en.wikipedia.org/wiki/"

DEPICTS_KM = 25.0
PLACE_KM = 30.0
MIN_DESCRIPTION = 20
MAX_DESCRIPTION = 240

FIELDS = ("id", "description", "wikipedia_title", "wikipedia_url", "link_via")

# A description without a language tag is kept only if one of these words is in it. Picked to
# be common in English captions and rare as whole words in other languages Commons is written in.
ENGLISH_MARKERS = frozenset(
    {"the", "of", "and", "from", "with", "near", "view", "seen", "towards", "between", "is"}
    | {"was", "which", "looking"}
)

GetJson = Callable[[str], Mapping]

_URL = re.compile(r"https?://\S+")
_LANG_LABEL = re.compile(r"^\s*english\s*:\s*", re.IGNORECASE)
_WORD = re.compile(r"[a-z]+")


@dataclass(frozen=True)
class CatalogPhoto:
    id: str
    title: str
    place: str
    lat: float
    lon: float


@dataclass(frozen=True)
class Postcard:
    id: str
    description: str
    wikipedia_title: str
    link_via: str  # "depicts", "place" or "" (no article)

    @property
    def wikipedia_url(self) -> str:
        if not self.wikipedia_title:
            return ""
        return ENWIKI_PAGE + urllib.parse.quote(self.wikipedia_title.replace(" ", "_"))

    def row(self) -> dict[str, str]:
        return {
            "id": self.id,
            "description": self.description,
            "wikipedia_title": self.wikipedia_title,
            "wikipedia_url": self.wikipedia_url,
            "link_via": self.link_via,
        }


# --- text --------------------------------------------------------------------------------------


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def reads_as_english(text: str) -> bool:
    return any(w in ENGLISH_MARKERS for w in _words(text))


def trim(text: str, limit: int = MAX_DESCRIPTION) -> str:
    """At most `limit` characters: whole sentences if a sentence ends past the halfway mark,
    otherwise whole words with an ellipsis."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    ends = [m.end() for m in re.finditer(r"[.!?](?=\s)", head + " ")]
    if ends and ends[-1] >= limit // 2:
        return head[: ends[-1]].strip()
    cut = head[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return cut + "…"


def clean_description(value: object, file_title: str) -> str | None:
    """Plain, short English text from an `ImageDescription` extmetadata value, or None.

    `value` is what the API returns with `iiextmetadatamultilang=1`: a {lang: html} dict when
    the description is language-tagged, or a plain HTML string when it is not.
    """
    if isinstance(value, Mapping):
        raw = value.get("en")
        if not isinstance(raw, str):
            return None
        tagged = True
    elif isinstance(value, str):
        raw, tagged = value, False
    else:
        return None
    text = _URL.sub("", html_to_text(raw))
    text = " ".join(_LANG_LABEL.sub("", text).split()).strip(" -–—")
    if len(text) < MIN_DESCRIPTION or not any(c.isalpha() for c in text):
        return None
    if not tagged and not reads_as_english(text):
        return None
    stem = re.sub(r"\.[a-z0-9]{2,4}$", "", file_title.removeprefix("File:"), flags=re.I)
    if _words(text) == _words(stem):
        return None
    if text[0].islower():
        text = text[0].upper() + text[1:]
    return trim(text)


# --- geometry ----------------------------------------------------------------------------------


def km_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))


def place_candidates(place: str) -> list[str]:
    """Parts of a place name worth looking up: every part but the last (the country)."""
    parts = [p.strip() for p in place.split(",") if p.strip()]
    return list(dict.fromkeys(parts[:-1] if len(parts) > 1 else parts))


# --- API calls ---------------------------------------------------------------------------------


def _url(api: str, params: Mapping[str, str]) -> str:
    return f"{api}?{urllib.parse.urlencode({'format': 'json', 'maxlag': '5', **params})}"


def _chunks(items: Sequence[str], n: int = BATCH) -> Iterable[list[str]]:
    for start in range(0, len(items), n):
        yield list(items[start : start + n])


def fetch_descriptions(
    titles: Sequence[str], get_json: GetJson, api_url: str = COMMONS_API
) -> dict[str, tuple[int, object]]:
    """{asked title: (pageid, ImageDescription value)} for the files Commons has."""
    out: dict[str, tuple[int, object]] = {}
    for batch in _chunks(titles):
        params = {
            "action": "query",
            "formatversion": "2",
            "prop": "imageinfo",
            "iiprop": "extmetadata",
            "iiextmetadatafilter": "ImageDescription",
            "iiextmetadatalanguage": "en",
            "iiextmetadatamultilang": "1",
            "titles": "|".join(batch),
        }
        query = get_json(_url(api_url, params)).get("query", {})
        canonical = {t: t for t in batch}
        for n in query.get("normalized", []):
            canonical[n["from"]] = n["to"]
        pages = {p.get("title"): p for p in query.get("pages", []) if not p.get("missing")}
        for title in batch:
            page = pages.get(canonical[title])
            if not page or "pageid" not in page:
                continue
            info = (page.get("imageinfo") or [{}])[0]
            desc = (info.get("extmetadata") or {}).get("ImageDescription", {}).get("value")
            out[title] = (int(page["pageid"]), desc)
    return out


def _item_ids(statements: Iterable[Mapping]) -> list[str]:
    """Wikidata ids from a list of statements, preferred rank first, deprecated dropped."""
    ranked = sorted(
        (s for s in statements if s.get("rank") != "deprecated"),
        key=lambda s: s.get("rank") != "preferred",
    )
    ids = []
    for s in ranked:
        value = ((s.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, Mapping) and isinstance(value.get("id"), str):
            ids.append(value["id"])
    return ids


def fetch_depicts(
    pageids: Sequence[int], get_json: GetJson, api_url: str = COMMONS_API
) -> dict[int, list[str]]:
    """{pageid: [depicted Wikidata ids]} from each file's structured data (MediaInfo M<pageid>)."""
    out: dict[int, list[str]] = {}
    for batch in _chunks([f"M{p}" for p in pageids]):
        params = {"action": "wbgetentities", "props": "claims", "ids": "|".join(batch)}
        entities = get_json(_url(api_url, params)).get("entities", {})
        for mid, entity in entities.items():
            if not isinstance(entity, Mapping) or "missing" in entity:
                continue
            # MediaInfo calls them "statements"; older responses used "claims".
            claims = entity.get("statements") or entity.get("claims") or {}
            ids = _item_ids(claims.get("P180", []) if isinstance(claims, Mapping) else [])
            if ids:
                out[int(mid[1:])] = ids
    return out


@dataclass(frozen=True)
class Item:
    enwiki: str
    coords: tuple[float, float] | None


def fetch_items(
    qids: Sequence[str], get_json: GetJson, api_url: str = WIKIDATA_API
) -> dict[str, Item]:
    """{qid: Item} with each item's English Wikipedia title and first coordinate (P625)."""
    out: dict[str, Item] = {}
    for batch in _chunks(list(dict.fromkeys(qids))):
        params = {
            "action": "wbgetentities",
            "props": "sitelinks|claims",
            "sitefilter": "enwiki",
            "ids": "|".join(batch),
        }
        entities = get_json(_url(api_url, params)).get("entities", {})
        for qid, entity in entities.items():
            if not isinstance(entity, Mapping) or "missing" in entity:
                continue
            title = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title", "")
            coords = None
            for s in (entity.get("claims") or {}).get("P625", []):
                v = ((s.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}
                if "latitude" in v and "longitude" in v:
                    coords = (float(v["latitude"]), float(v["longitude"]))
                    break
            out[qid] = Item(enwiki=str(title), coords=coords)
    return out


def fetch_article_coords(
    titles: Sequence[str], get_json: GetJson, api_url: str = ENWIKI_API
) -> dict[str, tuple[str, tuple[float, float]]]:
    """{asked title: (article title, (lat, lon))} for titles whose article has coordinates.
    Redirects are followed; disambiguation pages have no coordinates, so they drop out."""
    out: dict[str, tuple[str, tuple[float, float]]] = {}
    for batch in _chunks(list(dict.fromkeys(titles))):
        params = {
            "action": "query",
            "formatversion": "2",
            "redirects": "1",
            "prop": "coordinates",
            "colimit": "max",
            "titles": "|".join(batch),
        }
        query = get_json(_url(api_url, params)).get("query", {})
        target = {t: t for t in batch}
        for key in ("normalized", "redirects"):
            for n in query.get(key, []):
                for asked, now in target.items():
                    if now == n["from"]:
                        target[asked] = n["to"]
        pages = {p.get("title"): p for p in query.get("pages", []) if not p.get("missing")}
        for asked, title in target.items():
            page = pages.get(title)
            coords = (page or {}).get("coordinates") or []
            if coords:
                out[asked] = (title, (float(coords[0]["lat"]), float(coords[0]["lon"])))
    return out


# --- assembly ----------------------------------------------------------------------------------


def read_catalog(path: Path) -> list[CatalogPhoto]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            CatalogPhoto(
                id=r["id"],
                title=title_from_url(r["source_url"]),
                place=r["place"],
                lat=float(r["lat"]),
                lon=float(r["lon"]),
            )
            for r in csv.DictReader(fh)
        ]


def build_postcards(
    photos: Sequence[CatalogPhoto],
    *,
    get_json: GetJson = http_get_json,
    commons_api: str = COMMONS_API,
    wikidata_api: str = WIKIDATA_API,
    enwiki_api: str = ENWIKI_API,
) -> list[Postcard]:
    """A postcard for every photo with a usable description or a nearby article, in catalog
    order."""
    described = fetch_descriptions([p.title for p in photos], get_json, commons_api)
    pageids = [pid for pid, _ in described.values()]
    depicts = fetch_depicts(pageids, get_json, commons_api)
    items = fetch_items([q for ids in depicts.values() for q in ids], get_json, wikidata_api)

    linked: dict[str, tuple[str, str]] = {}
    for p in photos:
        pageid = described.get(p.title, (None, None))[0]
        for qid in depicts.get(pageid, []) if pageid is not None else []:
            item = items.get(qid)
            near = item and item.coords and km_between(p.lat, p.lon, *item.coords) <= DEPICTS_KM
            if item and item.enwiki and near:
                linked[p.id] = (item.enwiki, "depicts")
                break

    need = [p for p in photos if p.id not in linked]
    articles = fetch_article_coords(
        [c for p in need for c in place_candidates(p.place)], get_json, enwiki_api
    )
    for p in need:
        for cand in place_candidates(p.place):
            hit = articles.get(cand)
            if hit and km_between(p.lat, p.lon, *hit[1]) <= PLACE_KM:
                linked[p.id] = (hit[0], "place")
                break

    cards = []
    for p in photos:
        desc = described.get(p.title, (None, None))[1]
        text = clean_description(desc, p.title) if desc is not None else None
        title, via = linked.get(p.id, ("", ""))
        if text or title:
            cards.append(Postcard(p.id, text or "", title, via))
    return cards


def write_postcards(path: Path, cards: Iterable[Postcard]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        for c in cards:
            w.writerow(c.row())


def summary(cards: Sequence[Postcard], n_photos: int) -> dict[str, int]:
    via = Counter(c.link_via for c in cards if c.link_via)
    return {
        "photos": n_photos,
        "postcards": len(cards),
        "with_description": sum(1 for c in cards if c.description),
        "with_article": sum(via.values()),
        "article_via_depicts": via["depicts"],
        "article_via_place": via["place"],
    }


TRANSIENT_API_ERRORS = frozenset({"maxlag", "ratelimited", "readonly", "internal_api_error"})


def polite(
    get_json: GetJson,
    pause_s: float,
    *,
    attempts: int = 5,
    backoff_s: float = 5.0,
    sleep: Callable[[float], None] = time.sleep,
) -> GetJson:
    """`get_json` with a pause before each call, as Wikimedia's API etiquette asks, retrying
    with backoff while the API answers "busy" (`maxlag` and friends). Other API errors raise."""

    def go(url: str) -> Mapping:
        for attempt in range(attempts):
            sleep(pause_s)
            data = get_json(url)
            error = data.get("error")
            if not error:
                return data
            if error.get("code") not in TRANSIENT_API_ERRORS or attempt == attempts - 1:
                raise RuntimeError(f"Wikimedia API error for {url}: {dict(error)}")
            sleep(backoff_s * 2**attempt)
        raise AssertionError("unreachable")

    return go


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--pause", type=float, default=0.2, help="seconds between API calls")
    args = ap.parse_args(argv)
    photos = read_catalog(args.catalog)
    cards = build_postcards(photos, get_json=polite(http_get_json, args.pause))
    write_postcards(args.out, cards)
    print(json.dumps(summary(cards, len(photos)), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
