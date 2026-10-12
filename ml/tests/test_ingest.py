import csv
import io
import json
import urllib.parse
from pathlib import Path

import numpy as np
import pytest

from whereabout_ml import ingest as ig

Image = pytest.importorskip("PIL.Image")


def scene(seed: int, size: tuple[int, int] = (480, 320)) -> "Image.Image":
    """A smooth, photo-like RGB image: low-frequency structure that differs per seed."""
    rng = np.random.default_rng(seed)
    coarse = (rng.random((6, 9, 3)) * 255).astype(np.uint8)
    return Image.fromarray(coarse).resize(size, Image.Resampling.BICUBIC)


def jpeg(image, quality: int = 90) -> "Image.Image":
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf)


# --- license capture -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("given", "want"),
    [
        ("CC BY-SA 4.0", "CC BY-SA 4.0"),
        ("cc-by-sa-3.0", "CC BY-SA 3.0"),
        ("CC BY-SA 2.5 ca", "CC BY-SA 2.5 ca"),
        ("CC BY 4.0", "CC BY 4.0"),
        ("  CC  BY 3.0 ", "CC BY 3.0"),
        ("CC0", "CC0"),
        ("CC0 1.0", "CC0"),
        ("CC-zero", "CC0"),
        ("Public domain", "Public domain"),
        ("PD-self", "Public domain"),
        ("CC BY-NC 4.0", None),
        ("CC BY-NC-SA 2.0", None),
        ("CC BY-ND 4.0", None),
        ("GFDL", None),
        ("Copyrighted", None),
        ("", None),
    ],
)
def test_normalize_license(given, want):
    assert ig.normalize_license(given) == want


def test_html_to_text_strips_links_and_entities():
    artist = '<a href="//commons.wikimedia.org/wiki/User:Basile_Morin">Basile&nbsp;Morin</a>'
    assert ig.html_to_text(artist) == "Basile Morin"
    assert ig.html_to_text("Jos&eacute; <b>da</b> Silva\n") == "José da Silva"


def commons_file(**overrides) -> ig.CommonsFile:
    meta = {
        "LicenseShortName": "CC BY-SA 4.0",
        "LicenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
        "Artist": "<a href='x'>Ann</a>",
        "GPSLatitude": "48.8584",
        "GPSLongitude": "2.2945",
    }
    meta.update(overrides.pop("meta", {}))
    base = dict(
        pageid=1,
        title="File:A.jpg",
        source_url="https://commons.wikimedia.org/wiki/File:A.jpg",
        thumb_url="https://upload.wikimedia.org/a.jpg",
        width=4000,
        height=3000,
        mime="image/jpeg",
        sha1="abc",
        meta=meta,
    )
    base.update(overrides)
    return ig.CommonsFile(**base)


def test_check_file_accepts_and_captures_credit():
    got = ig.check_file(commons_file())
    assert isinstance(got, ig.Accepted)
    assert (got.lat, got.lon, got.author, got.license) == (48.8584, 2.2945, "Ann", "CC BY-SA 4.0")


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"meta": {"LicenseShortName": "CC BY-NC 2.0"}}, "license not allowed: CC BY-NC 2.0"),
        ({"meta": {"LicenseShortName": ""}}, "license not allowed: none given"),
        ({"meta": {"Artist": ""}}, "no author to credit"),
        ({"meta": {"GPSLatitude": ""}}, "no camera coordinates"),
        ({"meta": {"GPSLongitude": "181"}}, "no camera coordinates"),
        ({"meta": {"GPSLatitude": "nan"}}, "no camera coordinates"),
        ({"meta": {"Restrictions": "trademarked|personality"}}, "personality rights"),
        ({"mime": "image/svg+xml"}, "not a photo"),
        ({"mime": "video/webm"}, "not a photo"),
    ],
)
def test_check_file_rejects_with_reason(overrides, reason):
    got = ig.check_file(commons_file(**overrides))
    assert isinstance(got, str) and got.startswith(reason)


def test_public_domain_needs_no_author():
    got = ig.check_file(commons_file(meta={"LicenseShortName": "Public domain", "Artist": ""}))
    assert isinstance(got, ig.Accepted) and got.author == ""


# --- perceptual hash -------------------------------------------------------------------------


def test_dct_matrix_is_orthonormal():
    d = ig._dct_matrix(32)
    assert np.allclose(d @ d.T, np.eye(32))


def test_phash_is_stable_under_resize_recompression_and_brightness():
    original = scene(1)
    h = ig.phash(original)
    smaller = original.resize((200, 133), Image.Resampling.BILINEAR)
    brighter = Image.fromarray(np.clip(np.asarray(original, np.int16) + 20, 0, 255).astype("u1"))
    for variant in (jpeg(original, 40), smaller, jpeg(smaller, 60), brighter):
        assert ig.hamming(h, ig.phash(variant)) <= ig.MAX_DISTANCE
    assert ig.phash(original) == h  # deterministic


def test_phash_separates_different_scenes():
    hashes = [ig.phash(scene(seed)) for seed in range(12)]
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            assert ig.hamming(hashes[i], hashes[j]) > ig.MAX_DISTANCE, (i, j)


def test_phash_honours_exif_orientation():
    upright = scene(3)
    stored = upright.rotate(90, expand=True)  # what a camera writes before tagging rotation
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90° clockwise to display"
    buf = io.BytesIO()
    stored.save(buf, "JPEG", quality=95, exif=exif)
    buf.seek(0)
    assert ig.hamming(ig.phash(Image.open(buf)), ig.phash(upright)) <= ig.MAX_DISTANCE


def test_hamming():
    assert ig.hamming(0b1011, 0b0001) == 2
    assert ig.hamming(2**64 - 1, 0) == 64


# --- dedupe ----------------------------------------------------------------------------------


def test_dedupe_keeps_the_largest_copy():
    items = [
        ig.Hashed("small", 0b0, 100),
        ig.Hashed("big", 0b1, 1000),
        ig.Hashed("far", 2**64 - 1, 5),
    ]
    assert ig.dedupe(items, max_distance=2) == [ig.Duplicate("small", "big", 1)]


def test_dedupe_threshold_is_inclusive():
    items = [ig.Hashed("a", 0, 10), ig.Hashed("b", 0b111, 5)]
    assert ig.dedupe(items, max_distance=3) == [ig.Duplicate("b", "a", 3)]
    assert ig.dedupe(items, max_distance=2) == []


def test_dedupe_does_not_chain():
    # a~b and b~c are within 4 bits, but a and c are 8 apart: a is kept, b joins a, c stays.
    a, b, c = 0, 0b1111, 0b11111111
    items = [ig.Hashed("a", a, 3), ig.Hashed("b", b, 2), ig.Hashed("c", c, 1)]
    assert ig.dedupe(items, max_distance=4) == [ig.Duplicate("b", "a", 4)]


def test_dedupe_ties_go_to_input_order():
    items = [ig.Hashed("first", 0, 10), ig.Hashed("second", 0, 10)]
    assert ig.dedupe(items) == [ig.Duplicate("second", "first", 0)]


# --- Commons metadata ------------------------------------------------------------------------


def api_page(pageid: int, title: str, thumb_url: str, **meta) -> dict:
    ext = {
        "LicenseShortName": "CC BY 4.0",
        "LicenseUrl": "https://creativecommons.org/licenses/by/4.0",
        "Artist": f"Author {pageid}",
        "GPSLatitude": "10.5",
        "GPSLongitude": "-20.25",
        "AttributionRequired": "true",
    }
    ext.update(meta)
    return {
        "pageid": pageid,
        "ns": 6,
        "title": title,
        "imageinfo": [
            {
                "size": 1,
                "width": 4000 - pageid,
                "height": 3000,
                "url": "https://upload.wikimedia.org/full.jpg",
                "thumburl": thumb_url,
                "descriptionurl": "https://commons.wikimedia.org/wiki/"
                + urllib.parse.quote(title.replace(" ", "_")),
                "sha1": f"sha{pageid}",
                "mime": "image/jpeg",
                "extmetadata": {
                    k: {"value": v, "source": "commons-desc-page"} for k, v in ext.items()
                },
            }
        ],
    }


class FakeApi:
    """Answers Commons queries from a dict of pages, recording each request's titles."""

    def __init__(self, pages: dict[str, dict], normalized: dict[str, str] | None = None):
        self.pages, self.normalized, self.requests = pages, normalized or {}, []

    def __call__(self, url: str) -> dict:
        query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        assert query["iiurlwidth"] == [str(ig.THUMB_WIDTH)]
        titles = query["titles"][0].split("|")
        self.requests.append(titles)
        out_pages, norm = [], []
        for t in titles:
            canon = self.normalized.get(t, t)
            if canon != t:
                norm.append({"from": t, "to": canon})
            out_pages.append(self.pages.get(canon) or {"ns": 6, "title": canon, "missing": True})
        return {"batchcomplete": True, "query": {"normalized": norm, "pages": out_pages}}


def test_fetch_metadata_batches_normalizes_and_reports_missing():
    titles = [f"File:P{i}.jpg" for i in range(ig.BATCH + 3)] + ["File:gone.jpg", "File:p_x.jpg"]
    pages = {t: api_page(i + 1, t, "https://t/x.jpg") for i, t in enumerate(titles[:-2])}
    pages["File:P x.jpg"] = api_page(999, "File:P x.jpg", "https://t/y.jpg")
    api = FakeApi(pages, normalized={"File:p_x.jpg": "File:P x.jpg"})
    found, missing = ig.fetch_metadata(titles, get_json=api)
    assert [len(r) for r in api.requests] == [ig.BATCH, 5]
    assert missing == ["File:gone.jpg"]
    assert found["File:p_x.jpg"].pageid == 999
    f = found["File:P0.jpg"]
    assert (f.pageid, f.sha1, f.width, f.mime) == (1, "sha1", 3999, "image/jpeg")
    assert f.meta["LicenseShortName"] == "CC BY 4.0"


def test_title_from_url():
    url = "https://commons.wikimedia.org/wiki/File:Saal_an_der_Saale%2C_Findelbergweg.jpg"
    assert ig.title_from_url(url) == "File:Saal an der Saale, Findelbergweg.jpg"
    with pytest.raises(ValueError):
        ig.title_from_url("https://example.org/photo.jpg")


# --- pipeline --------------------------------------------------------------------------------


@pytest.fixture
def sample(tmp_path: Path):
    """Five Commons files: two copies of one scene, a distinct scene, an NC file and a broken
    thumbnail; plus one title Commons does not have."""
    src = tmp_path / "remote"
    src.mkdir()
    scene(1).save(src / "a.jpg", quality=92)
    jpeg(scene(1).resize((300, 200)), 50).save(src / "a_copy.jpg")
    scene(2).save(src / "b.jpg", quality=92)
    (src / "broken.jpg").write_bytes(b"not an image")
    url = lambda name: (src / name).as_uri()  # noqa: E731
    pages = {
        "File:A.jpg": api_page(10, "File:A.jpg", url("a.jpg")),
        "File:A copy.jpg": api_page(11, "File:A copy.jpg", url("a_copy.jpg")),
        "File:B.jpg": api_page(12, "File:B.jpg", url("b.jpg")),
        "File:NC.jpg": api_page(13, "File:NC.jpg", url("b.jpg"), LicenseShortName="CC BY-NC 4.0"),
        "File:Broken.jpg": api_page(14, "File:Broken.jpg", url("broken.jpg")),
    }
    return FakeApi(pages), list(pages) + ["File:Gone.jpg"]


def test_ingest_end_to_end(sample, tmp_path):
    api, titles = sample
    result = ig.ingest(titles + ["File:A.jpg"], tmp_path / "cache", get_json=api)

    by_title = {r["title"]: r for r in result.rows}
    assert sorted(by_title) == ["File:A copy.jpg", "File:A.jpg", "File:B.jpg"]
    # A is the larger original (width 3990 vs 3989), so the copy points at it.
    assert by_title["File:A copy.jpg"]["duplicate_of"] == "10"
    assert int(by_title["File:A copy.jpg"]["distance"]) <= ig.MAX_DISTANCE
    assert by_title["File:A.jpg"]["duplicate_of"] == by_title["File:B.jpg"]["duplicate_of"] == ""
    a = by_title["File:A.jpg"]
    assert (a["license"], a["author"], a["lat"], a["lon"]) == (
        "CC BY 4.0",
        "Author 10",
        "10.500000",
        "-20.250000",
    )
    assert a["license_url"] == "https://creativecommons.org/licenses/by/4.0"
    assert a["attribution_required"] == "true" and len(a["phash"]) == 16

    reasons = {r["title"]: r["reason"] for r in result.rejected}
    assert reasons["File:Gone.jpg"] == "not found on Commons"
    assert reasons["File:NC.jpg"] == "license not allowed: CC BY-NC 4.0"
    assert reasons["File:Broken.jpg"].startswith("unreadable image")
    assert len(result.rejected) == 3  # the repeated title is not counted twice
    assert len(result.kept) == 2 and len(result.duplicates) == 1


def test_ingest_reuses_cached_thumbnails(sample, tmp_path):
    api, titles = sample
    cache = tmp_path / "cache"
    ig.ingest(titles, cache, get_json=api)
    calls = []

    def no_network(url: str, dest: Path) -> bool:
        calls.append(url)
        return False

    again = ig.ingest(titles, cache, get_json=api, fetch=no_network)
    assert calls == []
    assert len(again.rows) == 3


def test_missing_thumbnail_is_rejected(sample, tmp_path):
    api, titles = sample
    result = ig.ingest(["File:B.jpg"], tmp_path / "c", get_json=api, fetch=lambda u, d: False)
    assert result.rows == []
    assert result.rejected == [{"title": "File:B.jpg", "reason": "thumbnail not available"}]


def test_redirected_titles_count_once(tmp_path):
    src = tmp_path / "a.jpg"
    scene(4).save(src)
    page = api_page(20, "File:Real.jpg", src.as_uri())
    api = FakeApi({"File:Real.jpg": page}, normalized={"File:Alias.jpg": "File:Real.jpg"})
    result = ig.ingest(["File:Real.jpg", "File:Alias.jpg"], tmp_path / "c", get_json=api)
    assert len(result.rows) == 1
    assert result.rejected == [{"title": "File:Alias.jpg", "reason": "same file as another title"}]


def test_catalog_license_mismatches(tmp_path):
    catalog = tmp_path / "photos.csv"
    catalog.write_text(
        "id,source_url,license\n"
        "p1,https://commons.wikimedia.org/wiki/File:A.jpg,CC BY 4.0\n"
        "p2,https://commons.wikimedia.org/wiki/File:B.jpg,CC BY-SA 3.0\n"
        "p3,https://commons.wikimedia.org/wiki/File:C.jpg,CC0\n",
        encoding="utf-8",
    )
    rows = [
        {"title": "File:A.jpg", "license": "CC BY 4.0"},
        {"title": "File:B.jpg", "license": "CC BY-SA 4.0"},
    ]
    assert ig.catalog_license_mismatches(catalog, rows) == [
        {"id": "p2", "curated": "CC BY-SA 3.0", "captured": "CC BY-SA 4.0"}
    ]


def test_cli_writes_manifest_rejections_and_meta(sample, tmp_path, monkeypatch):
    api, titles = sample
    monkeypatch.setattr(ig, "http_get_json", api)
    titles_file = tmp_path / "titles.txt"
    titles_file.write_text("# sample\n" + "\n".join(titles) + "\n\n", encoding="utf-8")
    out = tmp_path / "out"

    assert (
        ig.main(
            [
                "--titles",
                str(titles_file),
                "--out-dir",
                str(out),
                "--cache-dir",
                str(tmp_path / "cache"),
            ]
        )
        == 0
    )

    with (out / "sample_manifest.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert tuple(rows[0]) == ig.MANIFEST_FIELDS
    assert [r["pageid"] for r in rows] == ["10", "11", "12"]
    with (out / "sample_rejected.csv").open(encoding="utf-8") as fh:
        assert len(list(csv.DictReader(fh))) == 3
    meta = json.loads((out / "sample_manifest.meta.json").read_text(encoding="utf-8"))
    assert (meta["titles"], meta["kept"], meta["duplicates"], meta["rejected"]) == (6, 2, 1, 3)
    assert meta["rejected_by_reason"] == {
        "license not allowed": 1,
        "not found on Commons": 1,
        "unreadable image": 1,
    }
    assert "catalog_license_mismatches" not in meta


def test_cli_needs_an_input(tmp_path):
    with pytest.raises(SystemExit):
        ig.main(["--out-dir", str(tmp_path)])
