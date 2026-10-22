"""The reference-set collector against a fake Commons API and local thumbnails."""

import csv
import random
import urllib.parse

import pytest

from whereabout_ml import reference_set as rs
from whereabout_ml.gazetteer import City
from whereabout_ml.harvest import Seed

TURIN = City("Turin", "IT", 45.07, 7.69, 870000)
CAPE_TOWN = City("Cape Town", "ZA", -33.92, 18.42, 3400000)
CATALOG_URL = "https://commons.wikimedia.org/wiki/File:Game_photo.jpg"


def info_page(pageid, title, thumb, *, lat, lon, license_="CC BY 4.0", mime="image/jpeg"):
    ext = {
        "LicenseShortName": license_,
        "Artist": f"<a href='x'>Author {pageid}</a>",
        "GPSLatitude": str(lat),
        "GPSLongitude": str(lon),
    }
    return {
        "pageid": pageid,
        "title": title,
        "imageinfo": [
            {
                "width": 4000,
                "height": 3000,
                "thumburl": thumb,
                "descriptionurl": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"),
                "sha1": f"sha{pageid}",
                "mime": mime,
                "extmetadata": {k: {"value": v} for k, v in ext.items()},
            }
        ],
    }


@pytest.fixture
def commons(tmp_path):
    """Files near Turin (one a game photo, one non-commercial, one far from every place) and
    near Cape Town, with thumbnails on disk."""
    remote = tmp_path / "remote"
    remote.mkdir()

    def thumb(pageid):
        path = remote / f"330px-{pageid}.jpg"
        path.write_bytes(b"jpeg bytes")
        return path.as_uri()

    near = {
        "45.07000|7.69000": [
            ("File:Game photo.jpg", 45.07, 7.69),
            ("File:Mole.jpg", 45.069, 7.693),
            ("File:Po river.JPG", 45.06, 7.70),
            ("File:Non commercial.jpg", 45.08, 7.68),
            ("File:Map.svg", 45.07, 7.69),
            ("File:Lost at sea.jpg", 30.0, -40.0),
        ],
        "-33.92000|18.42000": [("File:Table Mountain.jpg", -33.96, 18.40)],
    }
    pages = {}
    for i, (title, lat, lon) in enumerate(sum(near.values(), []), start=1):
        lic = "CC BY-NC 4.0" if "commercial" in title else "CC BY-SA 4.0"
        pages[title] = info_page(i, title, thumb(i), lat=lat, lon=lon, license_=lic)
    calls = []

    def http(url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        calls.append(q)
        if q.get("list") == "geosearch":
            hits = near.get(q["gscoord"], [])
            return {"query": {"geosearch": [{"title": t, "lat": a, "lon": o} for t, a, o in hits]}}
        titles = q["titles"].split("|")
        return {"query": {"pages": [pages[t] for t in titles if t in pages]}}

    return http, calls


def test_collect_keeps_licensed_geotagged_files_that_are_not_game_photos(commons):
    http, _ = commons
    rows, stats = rs.collect(
        places=[TURIN, CAPE_TOWN],
        exclude_titles={"File:Game photo.jpg"},
        settings=rs.Settings(seeds_per_cell=1, per_seed=10, pause_s=0),
        http=http,
        sleep=lambda s: None,
    )
    titles = [r["title"] for r in rows]
    assert sorted(titles) == ["File:Mole.jpg", "File:Po river.JPG", "File:Table Mountain.jpg"]
    assert stats["game or harvested photos skipped"] == 1
    assert stats["rejected: license not allowed"] == 1
    assert stats["rejected: more than 150 km from every place"] == 1
    assert stats["references"] == 3
    mole = next(r for r in rows if r["title"] == "File:Mole.jpg")
    assert (mole["country"], mole["place"], mole["license"]) == ("IT", "Turin", "CC BY-SA 4.0")
    assert mole["author"].startswith("Author ") and mole["id"].startswith("wr")
    assert set(mole) == set(rs.FIELDS)
    # Round-robin over cells: the first two rows are in different cells.
    assert {rows[0]["country"], rows[1]["country"]} == {"IT", "ZA"}


def test_discover_takes_at_most_per_seed_and_each_title_once():
    seeds = [Seed("A", "IT", 45.0, 7.0, "r13c18"), Seed("B", "IT", 45.01, 7.01, "r13c18")]
    same = {"query": {"geosearch": [{"title": f"File:{i}.jpg"} for i in range(10)]}}
    found, stats = rs.discover(seeds, 3, [], rng=random.Random(0), http=lambda url: same)
    assert len(found) == 3, "the second seed only finds titles the first already saw"
    assert len({t for t, _ in found}) == 3
    assert stats["seeds searched"] == 2


def test_a_search_cut_short_by_its_budget_says_how_many_seeds_it_missed():
    seeds = [Seed(f"S{i}", "IT", 40.0 + i, 9.0, f"r{i}c0") for i in range(5)]
    hits = {"query": {"geosearch": [{"title": "File:x.jpg"}]}}
    ticks = iter(range(100))
    _, stats = rs.discover(
        seeds, 1, [], rng=random.Random(0), http=lambda url: hits, budget_s=3,
        clock=lambda: next(ticks),
    )  # fmt: skip
    assert stats["seeds searched"] == 2
    assert stats["seeds not searched (time budget)"] == 3


def test_round_robin_interleaves_cells():
    rows = [{"cell": c, "n": str(i)} for i, c in enumerate("aaab")]
    assert [r["n"] for r in rs.round_robin(rows)] == ["0", "3", "1", "2"]


def test_thumbnails_stop_at_the_budget_and_resume_later(tmp_path):
    rows = [{"id": f"wr{i}", "thumb_url": f"https://t/{i}.jpg"} for i in range(5)]
    images = tmp_path / "images"
    got = []

    def fetch(url, dest):
        got.append(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x")
        return url != "https://t/1.jpg"  # one file is gone from Commons

    ticks = iter(range(100))
    first = rs.fetch_thumbnails(
        rows, images, budget_s=3, fetch=fetch, pause_s=0, clock=lambda: next(ticks)
    )
    assert (first.downloaded, first.unavailable, first.left) == (1, 1, 3)
    second = rs.fetch_thumbnails(rows, images, budget_s=None, fetch=fetch, pause_s=0)
    assert second.left == 0 and second.cached == 2 and second.downloaded == 3


def test_main_writes_the_csv_then_reuses_it_without_calling_commons(commons, tmp_path, capsys):
    http, calls = commons
    geo = tmp_path / "geonames"
    geo.mkdir()
    lines = []
    for i, c in enumerate([TURIN, CAPE_TOWN]):
        cols = [str(i), c.name, c.name, "", str(c.lat), str(c.lon), "P", "PPL", c.country]
        lines.append("\t".join(cols + [""] * 5 + [str(c.population)]))
    (geo / "cities15000.txt").write_text("\n".join(lines) + "\n")
    catalog = tmp_path / "photos.csv"
    catalog.write_text(f"id,source_url\nwm1,{CATALOG_URL}\n")
    out = tmp_path / "references.csv"
    images = tmp_path / "images"
    argv = [
        "--gazetteer", str(geo), "--exclude", str(catalog), "--out", str(out),
        "--images", str(images), "--seeds-per-cell", "1", "--per-seed", "10",
    ]  # fmt: skip
    assert rs.main(argv, http=http) == 0
    with out.open() as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 3 and "File:Game photo.jpg" not in {r["title"] for r in rows}
    assert all((images / f"{r['id']}.jpg").exists() for r in rows)
    assert "reference thumbnails: 0 cached, 3 downloaded" in capsys.readouterr().out

    calls.clear()
    assert rs.main(argv, http=http) == 0
    assert calls == [], "an existing reference set is reused without searching again"
    assert "3 cached, 0 downloaded" in capsys.readouterr().out
