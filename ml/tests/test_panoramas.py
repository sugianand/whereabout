import json
import urllib.parse
from pathlib import Path

import numpy as np
import pytest

from whereabout_ml import ingest
from whereabout_ml import panoramas as pano

Image = pytest.importorskip("PIL.Image")


def page(pageid, title, thumb_url, *, width=8000, height=4000, lat="10", lon="20", **meta):
    ext = {
        "LicenseShortName": "CC BY-SA 4.0",
        "Artist": f"Author {pageid}",
        "GPSLatitude": lat,
        "GPSLongitude": lon,
        **meta,
    }
    return {
        "pageid": pageid,
        "title": title,
        "imageinfo": [
            {
                "width": width,
                "height": height,
                "thumburl": thumb_url,
                "descriptionurl": f"https://commons.wikimedia.org/wiki/{title}",
                "sha1": "x",
                "mime": "image/jpeg",
                "extmetadata": {k: {"value": v} for k, v in ext.items()},
            }
        ],
    }


class FakeSearch:
    """Serves generator=search results in pages of `size`, per query."""

    def __init__(self, results: dict[str, list[dict]], size: int = 2):
        self.results, self.size, self.calls = results, size, []

    def __call__(self, url: str) -> dict:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        query, offset = q["gsrsearch"][0], int(q["gsroffset"][0])
        self.calls.append((query, offset))
        hits = self.results.get(query, [])
        out: dict = {"query": {"pages": hits[offset : offset + self.size]}}
        if offset + self.size < len(hits):
            out["continue"] = {"gsroffset": offset + self.size}
        return out


def test_is_equirectangular():
    assert pano.is_equirectangular(8000, 4000)
    assert pano.is_equirectangular(8001, 4000)
    assert not pano.is_equirectangular(8000, 3000)  # a wide crop, not a sphere
    assert not pano.is_equirectangular(4000, 4000)
    assert not pano.is_equirectangular(10, 0)


def test_game_url_rewrites_thumbnail_width():
    thumb = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/P_1.jpg/960px-P_1.jpg"
    assert pano.game_url(thumb, 3840).endswith("/thumb/a/ab/P_1.jpg/3840px-P_1.jpg")
    original = "https://upload.wikimedia.org/wikipedia/commons/a/ab/P.jpg"
    assert pano.game_url(original, 3840) == original


def accepted(pageid, lat, lon, pixels):
    f = ingest.CommonsFile(pageid, f"File:{pageid}", "", "", pixels, 1, "image/jpeg", "", {})
    return ingest.Accepted(f, lat, lon, "a", "CC0")


def test_spread_caps_each_cell_and_prefers_large_files():
    items = [accepted(1, 48.1, 2.1, 10), accepted(2, 48.2, 2.2, 30), accepted(3, 48.3, 2.3, 20)]
    items.append(accepted(4, -33.9, 151.2, 5))
    kept = pano.spread(items, per_cell=2)
    assert [a.file.pageid for a in kept] == [2, 3, 4]


def test_search_follows_continuation():
    api = FakeSearch({"q": [page(i, f"File:{i}.jpg", "u") for i in range(1, 6)]})
    got = [f.pageid for f in pano.search("q", get_json=api)]
    assert got == [1, 2, 3, 4, 5]
    assert [o for _, o in api.calls] == [0, 2, 4]
    assert len(list(pano.search("q", get_json=api, max_results=2))) == 2


def test_harvest_filters_dedupes_and_writes_sheets(tmp_path: Path):
    src = tmp_path / "remote"
    src.mkdir()
    rng = np.random.default_rng(0)
    for name in ("a", "b"):
        coarse = (rng.random((4, 8, 3)) * 255).astype(np.uint8)
        Image.fromarray(coarse).resize((960, 480), Image.Resampling.BICUBIC).save(
            src / f"{name}.jpg"
        )
    Image.open(src / "a.jpg").resize((900, 450)).save(src / "a_copy.jpg", quality=60)

    def thumb(name):
        return (src / f"{name}.jpg").as_uri()

    results = {
        "q1": [
            page(1, "File:A.jpg", thumb("a")),
            page(2, "File:A copy.jpg", thumb("a_copy"), width=7000, height=3500, lat="-30"),
            page(3, "File:Wide.jpg", thumb("a"), width=9000, height=3000),
            page(4, "File:Small.jpg", thumb("a"), width=2000, height=1000),
            page(5, "File:NC.jpg", thumb("a"), LicenseShortName="CC BY-NC 4.0"),
            page(6, "File:Known.jpg", thumb("a")),
        ],
        "q2": [page(1, "File:A.jpg", thumb("a")), page(7, "File:B.jpg", thumb("b"), lon="-70")],
    }
    result = pano.harvest(
        tmp_path / "cache",
        queries=("q1", "q2"),
        exclude_titles=frozenset({"File:Known.jpg"}),
        get_json=FakeSearch(results),
        limit=10,
    )
    titles = [r["title"] for r in result.candidates]
    assert titles == ["File:A.jpg", "File:B.jpg"]
    assert [r["n"] for r in result.candidates] == ["1", "2"]
    assert result.meta["dropped"] == {
        "already in the catalog": 1,
        "license not allowed": 1,
        "narrower than 4000 px": 1,
        "near-duplicate": 1,
        "not 2:1 equirectangular": 1,
    }
    assert result.meta["files_found"] == 7
    assert result.meta["per_query"] == {"q1": 6, "q2": 2}

    sheets = pano.contact_sheets(result.candidates, tmp_path / "cache", tmp_path / "sheets")
    assert [p.name for p in sheets] == ["sheet-01.jpg"]
    with Image.open(sheets[0]) as im:
        assert im.size == (1440, 388)


def test_cli_writes_outputs(tmp_path, monkeypatch):
    src = tmp_path / "p.jpg"
    Image.new("RGB", (960, 480), "teal").save(src)
    api = FakeSearch({q: [page(9, "File:P.jpg", src.as_uri())] for q in pano.QUERIES})
    monkeypatch.setattr(ingest, "http_get_json", api)
    out = tmp_path / "out"
    assert pano.main(["--out-dir", str(out), "--cache-dir", str(tmp_path / "c")]) == 0
    meta = json.loads((out / "candidates.meta.json").read_text())
    assert (meta["candidates"], meta["sheets"]) == (1, 1)
    assert (out / "candidates.csv").read_text().count("\n") == 2
