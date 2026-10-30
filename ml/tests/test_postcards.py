import csv
import urllib.parse

import pytest

from whereabout_ml import postcards as pc


def params(url: str) -> dict[str, str]:
    return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))


def statement(qid: str, rank: str = "normal") -> dict:
    return {"rank": rank, "mainsnak": {"datavalue": {"value": {"id": qid}}}}


def coord(lat: float, lon: float) -> dict:
    return {"mainsnak": {"datavalue": {"value": {"latitude": lat, "longitude": lon}}}}


class FakeWikimedia:
    """Answers the four kinds of request build_postcards makes, from small dicts."""

    def __init__(self, files: dict, mediainfo: dict, items: dict, articles: dict, redirects=()):
        self.files = files  # title -> (pageid, ImageDescription value or None)
        self.mediainfo = mediainfo  # pageid -> [statements]
        self.items = items  # qid -> (enwiki title, (lat, lon) or None)
        self.articles = articles  # title -> (lat, lon) or None
        self.redirects = dict(redirects)
        self.urls: list[str] = []

    def __call__(self, url: str) -> dict:
        self.urls.append(url)
        p = params(url)
        assert p["format"] == "json" and p["maxlag"] == "5"
        if url.startswith(pc.COMMONS_API) and p["action"] == "query":
            pages = []
            for t in p["titles"].split("|"):
                if t not in self.files:
                    pages.append({"title": t, "missing": True})
                    continue
                pid, desc = self.files[t]
                meta = {} if desc is None else {"ImageDescription": {"value": desc}}
                pages.append({"pageid": pid, "title": t, "imageinfo": [{"extmetadata": meta}]})
            return {"query": {"pages": pages}}
        if url.startswith(pc.COMMONS_API) and p["action"] == "wbgetentities":
            ents = {}
            for mid in p["ids"].split("|"):
                st = self.mediainfo.get(int(mid[1:]))
                ents[mid] = {"id": mid, "statements": {"P180": st}} if st else {"id": mid}
            return {"entities": ents}
        if url.startswith(pc.WIKIDATA_API):
            assert p["sitefilter"] == "enwiki"
            ents = {}
            for q in p["ids"].split("|"):
                if q not in self.items:
                    ents[q] = {"id": q, "missing": ""}
                    continue
                title, c = self.items[q]
                ents[q] = {
                    "sitelinks": {"enwiki": {"title": title}} if title else {},
                    "claims": {"P625": [coord(*c)]} if c else {},
                }
            return {"entities": ents}
        if url.startswith(pc.ENWIKI_API):
            asked = p["titles"].split("|")
            redirects = [{"from": t, "to": self.redirects[t]} for t in asked if t in self.redirects]
            pages = []
            for t in asked:
                t = self.redirects.get(t, t)
                if t not in self.articles:
                    pages.append({"title": t, "missing": True})
                    continue
                c = self.articles[t]
                page = {"title": t}
                if c:
                    page["coordinates"] = [{"lat": c[0], "lon": c[1]}]
                pages.append(page)
            return {"query": {"redirects": redirects, "pages": pages}}
        raise AssertionError(f"unexpected request {url}")


# --- descriptions ------------------------------------------------------------------------------


def test_a_language_tagged_description_keeps_only_english_as_plain_text():
    value = {
        "en": 'The <a href="/wiki/Saale">Saale</a> bridge at&nbsp;dawn, seen from the hill',
        "de": "Die Saalebrücke",
        "_type": "lang",
    }
    got = pc.clean_description(value, "File:Saale bridge.jpg")
    assert got == "The Saale bridge at dawn, seen from the hill"
    assert pc.clean_description({"de": "Die Saalebrücke bei Sonnenaufgang"}, "File:x.jpg") is None


def test_an_untagged_description_must_read_as_english():
    assert pc.clean_description("View of the harbour from the old fort", "File:x.jpg")
    assert pc.clean_description("Vista del puerto desde el fuerte viejo", "File:x.jpg") is None


def test_descriptions_that_say_nothing_are_dropped():
    title = "File:Saal an der Saale, Findelbergweg, Saale bridge.jpg"
    assert pc.clean_description("Saal an der Saale, Findelbergweg, Saale bridge", title) is None
    assert pc.clean_description("Bridge of the", title) is None  # under 20 characters
    assert pc.clean_description("https://example.org/a-very-long-link-to-nowhere", title) is None
    assert pc.clean_description(None, title) is None


def test_a_language_label_and_links_are_removed_and_the_first_letter_capitalised():
    got = pc.clean_description(
        "English: sunrise over the karst peaks, see https://x.org/y for more", "File:a.jpg"
    )
    assert got == "Sunrise over the karst peaks, see for more"


def test_long_descriptions_end_on_a_sentence_or_an_ellipsis():
    sentences = "The old town sits on a hill above the river. " * 10
    got = pc.trim(sentences.strip())
    assert len(got) <= pc.MAX_DESCRIPTION and got.endswith(".")
    words = "word " * 100
    got = pc.trim(words.strip())
    assert len(got) <= pc.MAX_DESCRIPTION and got.endswith("…") and "  " not in got


# --- articles ----------------------------------------------------------------------------------


def test_place_candidates_skip_the_country():
    assert pc.place_candidates("Saal an der Saale, Bavaria, Germany") == [
        "Saal an der Saale",
        "Bavaria",
    ]
    assert pc.place_candidates("Iceland") == ["Iceland"]


def photo(pid: str, title: str, place: str, lat: float = 50.0, lon: float = 10.0):
    return pc.CatalogPhoto(pid, title, place, lat, lon)


def test_a_nearby_depicted_item_links_its_article_before_the_place_name():
    fake = FakeWikimedia(
        files={"File:A.jpg": (11, {"en": "The castle above the town at dusk"})},
        # Preferred rank first; "sky" (no coordinate) and a far-away namesake are skipped.
        mediainfo={
            11: [statement("Q_sky"), statement("Q_far"), statement("Q_castle", "preferred")]
        },
        items={
            "Q_sky": ("Sky", None),
            "Q_far": ("Castle (Ohio)", (40.0, -80.0)),
            "Q_castle": ("Burg Example", (50.05, 10.05)),
        },
        articles={"Exampletown": (50.0, 10.0)},
    )
    cards = pc.build_postcards([photo("wm1", "File:A.jpg", "Exampletown, Germany")], get_json=fake)
    assert cards == [
        pc.Postcard("wm1", "The castle above the town at dusk", "Burg Example", "depicts")
    ]
    assert cards[0].wikipedia_url == "https://en.wikipedia.org/wiki/Burg_Example"
    assert not any(u.startswith(pc.ENWIKI_API) for u in fake.urls)  # no place lookup needed


def test_without_a_depicted_place_the_nearest_named_part_of_the_place_is_linked():
    fake = FakeWikimedia(
        files={"File:B.jpg": (12, None)},
        mediainfo={12: [statement("Q_far")]},
        items={"Q_far": ("Somewhere", (0.0, 0.0))},
        # The town's own name is a disambiguation page (no coordinates); the region redirects.
        articles={"Saal": None, "Lower Franconia": (50.02, 10.01)},
        redirects={"Unterfranken": "Lower Franconia"},
    )
    cards = pc.build_postcards(
        [photo("wm2", "File:B.jpg", "Saal, Unterfranken, Germany")], get_json=fake
    )
    assert cards == [pc.Postcard("wm2", "", "Lower Franconia", "place")]


def test_a_place_article_too_far_from_the_camera_is_not_used_and_nothing_is_guessed():
    fake = FakeWikimedia(
        files={"File:C.jpg": (13, "Vista del puerto")},
        mediainfo={},
        items={},
        articles={"Springfield": (39.8, -89.6)},
    )
    cards = pc.build_postcards([photo("wm3", "File:C.jpg", "Springfield, Germany")], get_json=fake)
    assert cards == []


def test_files_missing_from_commons_can_still_get_a_place_article():
    fake = FakeWikimedia(files={}, mediainfo={}, items={}, articles={"Exampletown": (50, 10)})
    cards = pc.build_postcards([photo("wm4", "File:Gone.jpg", "Exampletown, DE")], get_json=fake)
    assert cards == [pc.Postcard("wm4", "", "Exampletown", "place")]


def test_requests_are_batched_at_the_api_limit():
    files = {f"File:{i}.jpg": (100 + i, None) for i in range(pc.BATCH + 3)}
    fake = FakeWikimedia(files=files, mediainfo={}, items={}, articles={})
    photos = [photo(f"wm{i}", t, "Nowhere") for i, t in enumerate(files)]
    pc.build_postcards(photos, get_json=fake)
    commons = [u for u in fake.urls if params(u).get("prop") == "imageinfo"]
    assert [len(params(u)["titles"].split("|")) for u in commons] == [pc.BATCH, 3]


# --- output and etiquette ------------------------------------------------------------------------


def test_written_postcards_round_trip_with_their_header(tmp_path):
    out = tmp_path / "postcards" / "postcards.csv"
    cards = [pc.Postcard("wm1", 'A "quoted", comma', "Burg Example", "depicts")]
    pc.write_postcards(out, cards)
    rows = list(csv.DictReader(out.open(encoding="utf-8")))
    assert rows == [
        {
            "id": "wm1",
            "description": 'A "quoted", comma',
            "wikipedia_title": "Burg Example",
            "wikipedia_url": "https://en.wikipedia.org/wiki/Burg_Example",
            "link_via": "depicts",
        }
    ]
    assert pc.summary(cards, 5) == {
        "photos": 5,
        "postcards": 1,
        "with_description": 1,
        "with_article": 1,
        "article_via_depicts": 1,
        "article_via_place": 0,
    }


def test_polite_retries_maxlag_and_raises_other_api_errors():
    answers = [{"error": {"code": "maxlag"}}, {"ok": 1}]
    slept: list[float] = []
    go = pc.polite(lambda url: answers.pop(0), 0.1, sleep=slept.append)
    assert go("u") == {"ok": 1}
    assert slept == [0.1, 5.0, 0.1]
    bad = pc.polite(lambda url: {"error": {"code": "badvalue"}}, 0, sleep=lambda s: None)
    with pytest.raises(RuntimeError, match="badvalue"):
        bad("u")


def test_the_catalog_reads_titles_from_source_urls(tmp_path):
    path = tmp_path / "photos.csv"
    path.write_text(
        "id,image_url,lat,lon,place,country,author,license,source_url\n"
        'wm1,x,50.3,10.3,"Saal, Bavaria, Germany",DE,A,CC0,'
        '"https://commons.wikimedia.org/wiki/File:Saal_an_der_Saale,_bridge.jpg"\n',
        encoding="utf-8",
    )
    assert pc.read_catalog(path) == [
        pc.CatalogPhoto(
            "wm1", "File:Saal an der Saale, bridge.jpg", "Saal, Bavaria, Germany", 50.3, 10.3
        )
    ]
