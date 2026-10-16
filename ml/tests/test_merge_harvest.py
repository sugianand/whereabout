from pathlib import Path

import pytest

from whereabout_ml import merge_harvest as mh

REPO = Path(__file__).resolve().parents[2]


def row(i, *, source=None, **over):
    r = {
        "id": i,
        "image_url": f"https://img.test/{i}.jpg",
        "lat": "10.5",
        "lon": "-20.25",
        "place": "Town, Country",
        "country": "PT",
        "author": "Ann",
        "license": "CC BY-SA 4.0",
        "source_url": source or f"https://commons.test/File:{i}.jpg",
    }
    r.update(over)
    return r


def test_appends_new_rows_in_harvest_order_up_to_the_limit():
    catalog = [row("wm000"), row("wm001")]
    harvested = [row("wh3"), row("wh1"), row("wh2")]
    out = mh.merge(catalog, harvested, limit=2)
    assert out.added == ["wh3", "wh1"]  # harvest order is grid-balancing order: keep it
    assert [r["id"] for r in out.rows] == ["wm000", "wm001", "wh3", "wh1"]
    assert (out.already, out.left) == (0, 1)


def test_skips_photos_already_in_the_catalog_by_id_or_commons_page():
    catalog = [row("wm000", source="https://commons.test/File:Same.jpg"), row("wh7")]
    harvested = [row("wh9", source="https://commons.test/File:Same.jpg"), row("wh7"), row("wh8")]
    out = mh.merge(catalog, harvested, limit=10)
    assert out.added == ["wh8"]
    assert out.already == 2


def test_a_second_run_picks_up_where_the_first_stopped():
    harvested = [row(f"wh{i}") for i in range(5)]
    first = mh.merge([row("wm000")], harvested, limit=2)
    second = mh.merge(first.rows, harvested, limit=2)
    assert second.added == ["wh2", "wh3"]
    assert (second.already, second.left) == (2, 1)


def test_catalog_rows_are_untouched():
    catalog = [row("wm000", place='Quote "here", and a comma')]
    out = mh.merge(catalog, [row("wh1")], limit=1)
    assert out.rows[0] == catalog[0]


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"author": " "}, "empty"),
        ({"license": ""}, "empty"),
        ({"lat": "91"}, "out of range"),
        ({"lon": "nan"}, "out of range"),
        ({"lat": "north"}, "not numbers"),
        ({"image_url": "http://img.test/x.jpg"}, "https"),
        ({"country": "Portugal"}, "ISO alpha-2"),
    ],
)
def test_a_malformed_harvest_row_fails_the_whole_merge(over, message):
    with pytest.raises(ValueError, match=message):
        mh.merge([row("wm000")], [row("wh1"), row("wh2", **over)], limit=1)


def test_negative_limit_is_an_error():
    with pytest.raises(ValueError):
        mh.merge([], [], limit=-1)


def test_cli_writes_the_catalog_in_the_same_format(tmp_path, capsys):
    catalog = tmp_path / "photos.csv"
    harvested = tmp_path / "harvested.csv"
    catalog.write_text(mh.to_csv([row("wm000", place="Saal an der Saale, Bavaria, Germany")]))
    harvested.write_text(mh.to_csv([row("wh1"), row("wh2")]))
    before = catalog.read_text()
    args = ["--catalog", str(catalog), "--harvested", str(harvested), "--limit", "1"]
    assert mh.main(args) == 0
    after = catalog.read_text()
    assert after.startswith(before)
    assert after[len(before) :].startswith("wh1,")
    assert "added 1 photos (catalog now 2); 0 already in the catalog, 1 left" in (
        capsys.readouterr().out
    )
    # Nothing new: the file is not rewritten.
    assert mh.main([*args[:4], "--limit", "0"]) == 0
    assert catalog.read_text() == after


def test_the_real_catalog_round_trips_byte_for_byte():
    path = REPO / "data" / "curation" / "photos.csv"
    header, rows = mh.read_rows(path)
    assert tuple(header) == mh.FIELDS
    assert mh.to_csv(rows) == path.read_text(encoding="utf-8")


def test_the_committed_harvest_is_mergeable():
    _, catalog = mh.read_rows(REPO / "data" / "curation" / "photos.csv")
    _, harvested = mh.read_rows(REPO / "data" / "harvest" / "harvested.csv")
    mh.merge(catalog, harvested, limit=len(harvested))  # raises on any malformed row
