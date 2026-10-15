"""The Commons harvester against a fake Commons API, local images and a stub CLIP encoder."""

import csv
import functools
import io
import json
import urllib.parse
from pathlib import Path

import numpy as np
import pytest

from whereabout_ml import harvest as hv
from whereabout_ml.gazetteer import City
from whereabout_ml.ingest import CommonsFile
from whereabout_ml.scene_gate import REASONS, REJECT_PROMPTS

Image = pytest.importorskip("PIL.Image")

REPO = Path(__file__).resolve().parents[2]
FEATURED = "Category:Featured pictures on Wikimedia Commons"
QUALITY = "Category:Quality images"


# --- grid and seeds --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lat", "lon", "key"),
    [
        (0.0, 0.0, "r9c18"),
        (-90.0, -180.0, "r0c0"),
        (90.0, 180.0, "r17c0"),  # the pole stays in the top row, 180 wraps to -180
        (48.85, 2.35, "r13c18"),
        (-33.92, 18.42, "r5c19"),
    ],
)
def test_cell_key(lat, lon, key):
    assert hv.cell_key(lat, lon, 10.0) == key


def city(name, lat, lon, country="FR", population=20_000):
    return City(name=name, country=country, lat=lat, lon=lon, population=population)


def test_pick_seeds_is_capped_per_cell_and_reproducible():
    towns = [city(f"T{i}", 45 + i * 0.1, 5 + i * 0.1) for i in range(10)]  # one cell
    towns += [city("Far", -20.5, 130.5, "AU")]
    seeds = hv.pick_seeds(towns, 10.0, 3, seed=7)
    assert len(seeds) == 4
    assert sum(s.cell == hv.cell_key(45, 5, 10) for s in seeds) == 3
    assert [s.name for s in seeds if s.country == "AU"] == ["Far"]
    assert hv.pick_seeds(list(reversed(towns)), 10.0, 3, seed=7) == seeds  # order-independent
    draws = {tuple(s.name for s in hv.pick_seeds(towns, 10.0, 3, seed=k)) for k in range(5)}
    assert len(draws) > 1  # the seed matters, so reruns can explore other towns


# --- discovery -------------------------------------------------------------------------------


def geo_page(title, *cats):
    page = {"ns": 6, "title": title}
    if cats:
        page["categories"] = [{"ns": 14, "title": c} for c in cats]
    return page


class FakeCommons:
    """Answers geosearch generator queries (by coordinate) and imageinfo queries (by title)."""

    def __init__(self, near: dict[str, list], files: dict[str, dict]):
        self.near, self.files, self.calls = near, files, []

    def __call__(self, url: str) -> dict:
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(url).query).items()}
        self.calls.append(q)
        if q.get("generator") == "geosearch":
            assert q["ggsradius"] == "10000" and q["ggsnamespace"] == "6"
            assert q["clcategories"] == f"{FEATURED}|{QUALITY}"
            pages = self.near.get(q["ggscoord"], [])
            if pages and isinstance(pages[0], list):  # a continued answer, in parts
                part = int(q.get("clcontinue", "0"))
                out = {"query": {"pages": pages[part]}}
                if part + 1 < len(pages):
                    out["continue"] = {"clcontinue": str(part + 1), "continue": "||"}
                return out
            return {"batchcomplete": True, "query": {"pages": pages}}
        titles = q["titles"].split("|")
        pages = [self.files.get(t) or {"ns": 6, "title": t, "missing": True} for t in titles]
        return {"query": {"pages": pages}}


def test_assessed_near_merges_continued_category_lists_and_prefers_featured():
    api = FakeCommons(
        {
            "1.00000|2.00000": [
                [geo_page("File:A.jpg", QUALITY), geo_page("File:B.jpg")],
                [geo_page("File:A.jpg", FEATURED), geo_page("File:C.jpg", QUALITY)],
            ]
        },
        {},
    )
    assert hv.assessed_near(1.0, 2.0, http=api) == {
        "File:A.jpg": "featured",
        "File:C.jpg": "quality",
    }
    assert [c.get("clcontinue") for c in api.calls] == [None, "1"]


def test_assessed_near_raises_on_api_errors():
    with pytest.raises(RuntimeError, match="badvalue"):
        hv.assessed_near(0, 0, http=lambda url: {"error": {"code": "badvalue"}})


def test_discover_dedupes_skips_the_catalog_and_caps_featured_first():
    a = hv.Seed("A", "FR", 1.0, 2.0, "r9c18")
    b = hv.Seed("B", "FR", 1.5, 2.5, "r9c18")
    api = FakeCommons(
        {
            "1.00000|2.00000": [
                geo_page("File:Q1.jpg", QUALITY),
                geo_page("File:Q2.jpg", QUALITY),
                geo_page("File:Cat.jpg", QUALITY),
            ],
            "1.50000|2.50000": [geo_page("File:Q1.jpg", QUALITY), geo_page("File:F.jpg", FEATURED)],
        },
        {},
    )
    slept = []
    found, stats = hv.discover(
        [a, b], 2, ["File:Cat.jpg"], http=api, pause_s=0.5, sleep=slept.append
    )
    assert [(c.title, c.assessment) for c in found] == [
        ("File:F.jpg", "featured"),
        ("File:Q1.jpg", "quality"),
    ]
    assert found[1].seed == a  # the first seed to find a file keeps it
    assert stats == {
        "seeds": 2,
        "cells_with_seeds": 1,
        "assessed_files_found": 4,
        "already_in_catalog": 1,
        "candidates": 2,
    }
    assert slept == [0.5]


# --- checks ----------------------------------------------------------------------------------


def test_sized_thumb_url_swaps_the_width_and_drops_tracking():
    thumb = (
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Upernavik_x.jpg/"
        "330px-Upernavik_x.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo"
    )
    assert hv.sized_thumb_url(thumb) == (
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Upernavik_x.jpg/"
        "1280px-Upernavik_x.jpg"
    )
    with pytest.raises(ValueError):
        hv.sized_thumb_url("https://upload.wikimedia.org/wikipedia/commons/5/58/Upernavik_x.jpg")


def commons_file(**over) -> CommonsFile:
    meta = {
        "LicenseShortName": "CC BY-SA 4.0",
        "Artist": "Ann",
        "GPSLatitude": "48.85",
        "GPSLongitude": "2.35",
    }
    meta.update(over.pop("meta", {}))
    base = dict(
        pageid=1,
        title="File:A.jpg",
        source_url="https://commons.wikimedia.org/wiki/File:A.jpg",
        thumb_url="https://thumb.wikimedia.org/x/A.jpg/330px-A.jpg",
        width=4000,
        height=3000,
        mime="image/jpeg",
        sha1="s",
        meta=meta,
    )
    base.update(over)
    return CommonsFile(**base)


@pytest.mark.parametrize(
    ("over", "reason"),
    [
        ({}, None),
        ({"title": "File:A.png", "mime": "image/png"}, "not a JPEG photo"),
        ({"title": "File:A.tif", "mime": "image/tiff"}, "not a JPEG photo"),
        ({"width": 1000, "height": 700}, "narrower than 1280 px"),
        ({"width": 3000, "height": 4000}, "not landscape"),
        ({"width": 3000, "height": 2500}, "not landscape"),
        ({"meta": {"LicenseShortName": "CC BY-NC 4.0"}}, "license not allowed: CC BY-NC 4.0"),
        ({"meta": {"Restrictions": "personality"}}, "personality rights (identifiable people)"),
        ({"meta": {"GPSLatitude": ""}}, "no camera coordinates"),
        ({"thumb_url": "https://upload.wikimedia.org/A.jpg"}, "no thumbnail rendition"),
    ],
)
def test_check_candidate(over, reason):
    assert hv.check_candidate(commons_file(**over)) == reason


# --- place names and balance -----------------------------------------------------------------


def test_place_namer_names_the_nearest_place_and_its_country():
    namer = hv.PlaceNamer(
        [city("Paris", 48.8566, 2.3522), city("Lyon", 45.764, 4.8357)],
        {"FR": "France"},
        near_km=15,
        max_km=150,
    )
    here, near, nowhere = namer.name([(48.86, 2.34), (48.5, 2.6), (40.0, -30.0)])
    assert here[:2] == ("Paris, France", "FR") and here[2] < 2
    assert near[:2] == ("near Paris, France", "FR") and 15 < near[2] < 150
    assert nowhere is None


def test_balance_fills_the_emptiest_cell_first_and_respects_the_cap():
    pool = {"a": ["a1", "a2", "a3"], "b": ["b1"], "c": ["c1", "c2"]}
    assert hv.balance(pool, {"a": 1}, 10, max_per_cell=3) == ["b1", "c1", "a1", "c2", "a2"]
    assert hv.balance(pool, {}, 2, max_per_cell=3) == ["a1", "b1"]
    assert hv.balance(pool, {"a": 3, "c": 3}, 10, max_per_cell=3) == ["b1"]
    assert hv.balance({}, {}, 5, 3) == []


# --- end to end ------------------------------------------------------------------------------


def scene(seed: int, size=(480, 320)):
    rng = np.random.default_rng(seed)
    coarse = (rng.random((6, 9, 3)) * 255).astype(np.uint8)
    return Image.fromarray(coarse).resize(size, Image.Resampling.BICUBIC)


DIM = len(REASONS) + 1


class StubEncoder:
    """Prompts land on one axis per reason (plus "good photo"); images on the axis set by their
    page id, so the test decides which photo the gate sees as a picture of people."""

    name = "stub/encoder"

    def __init__(self, people: set[int]):
        self.people = people

    def encode_texts(self, texts):
        rows = []
        for t in texts:
            axis = next((j for j, r in enumerate(REASONS) if t in REJECT_PROMPTS[r]), DIM - 1)
            rows.append(np.eye(DIM)[axis])
        return np.array(rows)

    def encode_images(self, paths):
        rows = []
        for p in paths:
            v = np.zeros(DIM)
            v[DIM - 1] = 1.0
            if int(Path(p).stem) in self.people:
                v[REASONS.index("people")] = 2.0
            rows.append(v)
        return np.array(rows)


def info_page(pageid, title, thumb, *, lat, lon, width=None, height=3000, mime="image/jpeg"):
    ext = {
        "LicenseShortName": "CC BY 4.0",
        "LicenseUrl": "https://creativecommons.org/licenses/by/4.0",
        "Artist": f"<a href='x'>Author {pageid}</a>",
        "GPSLatitude": str(lat),
        "GPSLongitude": str(lon),
    }
    return {
        "pageid": pageid,
        "ns": 6,
        "title": title,
        "imageinfo": [
            {
                "width": width or 4500 - pageid,
                "height": height,
                "thumburl": thumb,
                "descriptionurl": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"),
                "sha1": f"sha{pageid}",
                "mime": mime,
                "extmetadata": {k: {"value": v} for k, v in ext.items()},
            }
        ],
    }


PARIS = (48.8566, 2.3522)
CAPE_TOWN = (-33.9249, 18.4241)


@pytest.fixture
def world(tmp_path):
    """A catalog photo in Paris and candidates near Paris and Cape Town, one per failure."""
    remote = tmp_path / "remote"

    def thumb(pageid: int, image) -> str:
        path = remote / str(pageid) / f"330px-P{pageid}.jpg"
        path.parent.mkdir(parents=True)
        image.save(path, quality=92)
        return path.as_uri()

    def jpeg_copy(image):
        buf = io.BytesIO()
        image.resize((300, 200)).save(buf, "JPEG", quality=60)
        buf.seek(0)
        return Image.open(buf)

    p_lat, p_lon = PARIS[0] + 0.01, PARIS[1]
    c_lat, c_lon = CAPE_TOWN[0] + 0.01, CAPE_TOWN[1]
    files = {
        "File:Cat.jpg": info_page(1, "File:Cat.jpg", thumb(1, scene(1)), lat=p_lat, lon=p_lon),
        "File:P1.jpg": info_page(11, "File:P1.jpg", thumb(11, scene(11)), lat=p_lat, lon=p_lon),
        "File:P2.jpg": info_page(12, "File:P2.jpg", thumb(12, scene(12)), lat=p_lat, lon=p_lon),
        "File:P3.jpg": info_page(
            13, "File:P3.jpg", thumb(13, jpeg_copy(scene(1))), lat=p_lat, lon=p_lon
        ),
        "File:P4.png": info_page(
            14, "File:P4.png", thumb(14, scene(14)), lat=p_lat, lon=p_lon, mime="image/png"
        ),
        "File:P5.jpg": info_page(
            15, "File:P5.jpg", thumb(15, scene(15)), lat=p_lat, lon=p_lon, width=2000
        ),
        "File:P7.jpg": info_page(17, "File:P7.jpg", thumb(17, scene(17)), lat=p_lat, lon=p_lon),
        "File:Z1.jpg": info_page(21, "File:Z1.jpg", thumb(21, scene(21)), lat=c_lat, lon=c_lon),
        "File:Z2.jpg": info_page(
            22, "File:Z2.jpg", thumb(22, jpeg_copy(scene(21))), lat=c_lat, lon=c_lon
        ),
        "File:Z3.jpg": info_page(23, "File:Z3.jpg", thumb(23, scene(23)), lat=-50.0, lon=0.0),
    }
    near = {
        "48.85660|2.35220": [
            geo_page("File:Cat.jpg", QUALITY),
            geo_page("File:P1.jpg", QUALITY),
            geo_page("File:P2.jpg", FEATURED, QUALITY),
            geo_page("File:P3.jpg", QUALITY),
            geo_page("File:P4.png", QUALITY),
            geo_page("File:P5.jpg", QUALITY),
            geo_page("File:P6.jpg"),  # not assessed
            geo_page("File:P7.jpg", QUALITY),
        ],
        "-33.92490|18.42410": [
            geo_page("File:Z1.jpg", QUALITY),
            geo_page("File:Z2.jpg", QUALITY),
            geo_page("File:Z3.jpg", QUALITY),
            geo_page("File:Gone.jpg", QUALITY),
        ],
    }
    places = [
        city("Paris", *PARIS, "FR", 2_000_000),
        city("Cape Town", *CAPE_TOWN, "ZA", 4_000_000),
    ]
    return {
        "api": FakeCommons(near, files),
        "places": places,
        "country_names": {"FR": "France", "ZA": "South Africa"},
        "catalog_titles": ["File:Cat.jpg"],
        "catalog_points": [(p_lat, p_lon)],
    }


SETTINGS = hv.Settings(
    target=4, seeds_per_cell=1, candidates_per_cell=10, max_per_cell=2, pause_s=0.0
)


def run(world, tmp_path, people=frozenset({17})):
    return hv.harvest(
        places=world["places"],
        country_names=world["country_names"],
        catalog_titles=world["catalog_titles"],
        catalog_points=world["catalog_points"],
        thresholds=dict.fromkeys(REASONS, 0.0),
        encoder=StubEncoder(set(people)),
        cache_dir=tmp_path / "cache",
        settings=SETTINGS,
        http=world["api"],
    )


def test_harvest_end_to_end(world, tmp_path):
    result = run(world, tmp_path)

    reasons = {r["title"]: (r["stage"], r["reason"]) for r in result.rejected}
    assert reasons == {
        "File:Gone.jpg": ("metadata", "not found on Commons"),
        "File:P4.png": ("metadata", "not a JPEG photo"),
        "File:P5.jpg": ("metadata", "not landscape"),
        "File:P3.jpg": ("ingest", "near-duplicate of a catalog photo"),
        "File:Z2.jpg": ("ingest", "near-duplicate of another candidate"),
        "File:P7.jpg": ("scene_gate", "scene gate: people"),
        "File:Z3.jpg": ("place", "farther than 150 km from a place"),
    }

    # Room for 3 more photos. Cape Town's cell is empty, so Z1 comes first; Paris already holds
    # the catalog photo, so it gets one more (the featured P2) before reaching the cap of 2.
    assert [p["id"] for p in result.photos] == ["wh12", "wh21"]
    p2, z1 = result.photos
    assert p2["place"] == "Paris, France" and p2["country"] == "FR"
    assert z1["place"] == "Cape Town, South Africa" and z1["country"] == "ZA"
    assert p2["image_url"].endswith("/12/1280px-P12.jpg")
    assert (p2["author"], p2["license"]) == ("Author 12", "CC BY 4.0")
    assert p2["source_url"] == "https://commons.wikimedia.org/wiki/File:P2.jpg"
    assert set(p2) == set(hv.CATALOG_FIELDS)

    m = {row["id"]: row for row in result.manifest}
    assert m["wh12"]["assessment"] == "featured" and m["wh21"]["assessment"] == "quality"
    assert m["wh12"]["seed"] == "Paris, FR" and m["wh12"]["cell"] == "r13c18"
    assert float(m["wh12"]["gate_people"]) < 0 < float(m["wh12"]["place_km"])

    rep = result.report
    assert rep["discovery"] == {
        "seeds": 2,
        "cells_with_seeds": 2,
        "assessed_files_found": 11,
        "already_in_catalog": 1,
        "candidates": 10,
    }
    assert rep["rejected_by_stage"] == {
        "metadata": {"not a JPEG photo": 1, "not found on Commons": 1, "not landscape": 1},
        "ingest": {
            "near-duplicate of a catalog photo": 1,
            "near-duplicate of another candidate": 1,
        },
        "scene_gate": {"scene gate": 1},
        "place": {"farther than 150 km from a place": 1},
    }
    assert rep["scene_gate"]["screened"] == 5 and rep["scene_gate"]["passed"] == 4
    assert rep["scene_gate"]["rejected_by_reason"] == {
        "people": 1,
        "indoor": 0,
        "text": 0,
        "not_photo": 0,
    }
    assert rep["scene_gate"]["model"] == "stub/encoder"
    assert (rep["passed_all_checks"], rep["harvested"]) == (3, 2)
    assert (rep["catalog_before"], rep["catalog_after"], rep["cells_after"]) == (1, 3, 2)
    assert rep["licenses"] == {"CC BY 4.0": 2}


def test_harvested_rows_load_as_a_catalog(world, tmp_path):
    from whereabout_api.catalog import load_catalog

    result = run(world, tmp_path)
    for p in result.photos:  # the fake serves local files; Commons serves https
        p["image_url"] = p["image_url"].replace("file:///", "https://thumb.example/")
    hv.write_outputs(result, tmp_path / "out")
    photos = load_catalog(tmp_path / "out" / "harvested.csv")
    assert [p.id for p in photos] == ["wh12", "wh21"]


def test_target_already_met_harvests_nothing(world, tmp_path):
    world["catalog_points"] = world["catalog_points"] * 4
    assert run(world, tmp_path).photos == []


def test_write_outputs_and_markdown(world, tmp_path):
    out = tmp_path / "out"
    hv.write_outputs(run(world, tmp_path), out)
    with (out / "rejected.csv").open(newline="") as fh:
        stages = [r["stage"] for r in csv.DictReader(fh)]
    assert stages == sorted(stages, key=hv.STAGES.index)  # grouped in pipeline order
    with (out / "manifest.csv").open(newline="") as fh:
        assert tuple(csv.DictReader(fh).fieldnames) == hv.MANIFEST_FIELDS
    report = json.loads((out / "report.json").read_text())
    md = (out / "report.md").read_text()
    assert md.startswith("# Commons harvest")
    assert f"| Harvested after grid balancing | {report['harvested']} |" in md
    assert "| scene_gate | scene gate | 1 |" in md
    assert "| people | 0.0 | 1 |" in md


def test_load_thresholds_reads_the_calibrated_file():
    thresholds, model = hv.load_thresholds(REPO / "data" / "scene_gate" / "thresholds.json")
    assert set(thresholds) == set(REASONS)
    assert model[0] and model[1]


def test_load_thresholds_rejects_probability_files(tmp_path):
    path = tmp_path / "t.json"
    path.write_text(json.dumps({"thresholds": {}, "score": "probability", "model": "a/b"}))
    with pytest.raises(ValueError, match="log-odds"):
        hv.load_thresholds(path)


def test_cli(world, tmp_path, monkeypatch):
    geo = tmp_path / "geonames"
    geo.mkdir()
    (geo / "countryInfo.txt").write_text(
        "#ISO\tISO3\tnum\tfips\tCountry\nFR\tFRA\t250\tFR\tFrance\nZA\tZAF\t710\tSF\tSouth Africa\n"
    )

    def city_line(name, lat, lon, cc, pop):
        cols = [""] * 19
        cols[1] = cols[2] = name
        cols[4], cols[5], cols[8], cols[14] = str(lat), str(lon), cc, str(pop)
        return "\t".join(cols)

    (geo / "cities15000.txt").write_text(
        city_line("Paris", *PARIS, "FR", 2_000_000)
        + "\n"
        + city_line("Cape Town", *CAPE_TOWN, "ZA", 4_000_000)
        + "\n"
    )
    catalog = tmp_path / "photos.csv"
    lat, lon = world["catalog_points"][0]
    catalog.write_text(
        ",".join(hv.CATALOG_FIELDS)
        + "\n"
        + f"wm001,https://x/1280px-c.jpg,{lat},{lon},Paris,FR,A,CC BY 4.0,"
        + "https://commons.wikimedia.org/wiki/File:Cat.jpg\n"
    )
    thresholds = tmp_path / "thresholds.json"
    thresholds.write_text(
        json.dumps(
            {
                "thresholds": dict.fromkeys(REASONS, 0.0),
                "score": "log-odds",
                "model": "Stub-B/test",
            }
        )
    )
    monkeypatch.setattr(hv, "harvest", functools.partial(hv.harvest, http=world["api"]))
    made = []

    def factory(name, pretrained):
        made.append((name, pretrained))
        return StubEncoder({17})

    out = tmp_path / "out"
    code = hv.main(
        [
            "--gazetteer",
            str(geo),
            "--catalog",
            str(catalog),
            "--thresholds",
            str(thresholds),
            "--out-dir",
            str(out),
            "--cache-dir",
            str(tmp_path / "cache"),
            "--target",
            "4",
            "--seeds-per-cell",
            "1",
            "--max-per-cell",
            "2",
            "--pause-s",
            "0",
        ],
        encoder_factory=factory,
    )
    assert code == 0 and made == [("Stub-B", "test")]
    with (out / "harvested.csv").open(newline="") as fh:
        assert [r["id"] for r in csv.DictReader(fh)] == ["wh12", "wh21"]
    assert json.loads((out / "report.json").read_text())["settings"]["target"] == 4


def test_a_thumbnail_that_keeps_failing_is_rejected_not_fatal(world, tmp_path):
    from whereabout_ml.concept_labels import download

    def flaky(url, dest):
        if "/21/" in url:
            raise RuntimeError("gave up after 4 attempts: HTTP 429")
        return download(url, dest)

    slept = []
    result = hv.harvest(
        places=world["places"],
        country_names=world["country_names"],
        catalog_titles=world["catalog_titles"],
        catalog_points=world["catalog_points"],
        thresholds=dict.fromkeys(REASONS, 0.0),
        encoder=StubEncoder({17}),
        cache_dir=tmp_path / "cache",
        settings=hv.Settings(target=4, seeds_per_cell=1, max_per_cell=2, pause_s=0.25),
        http=world["api"],
        fetch=flaky,
        sleep=slept.append,
    )
    reasons = {r["title"]: (r["stage"], r["reason"]) for r in result.rejected}
    assert reasons["File:Z1.jpg"] == ("ingest", "thumbnail not available")
    # With Z1 gone, its copy Z2 is no longer a duplicate and takes its place.
    assert [p["id"] for p in result.photos] == ["wh12", "wh22"]
    assert slept and set(slept) == {0.25}
