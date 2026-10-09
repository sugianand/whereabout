from pathlib import Path

import pytest

from whereabout_api.catalog import CatalogError, load_catalog

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_CATALOG = REPO_ROOT / "data" / "curation" / "photos.csv"

HEADER = "id,image_url,lat,lon,place,country,author,license,source_url\n"
GOOD = (
    'wm001,https://example.org/a.jpg,35.0,135.7,"Kyoto, Japan",JP,Ann,CC BY-SA 4.0,'
    "https://example.org/a\n"
)


def write(tmp_path: Path, body: str, header: str = HEADER) -> Path:
    path = tmp_path / "photos.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_loads_a_valid_row(tmp_path):
    (photo,) = load_catalog(write(tmp_path, GOOD))
    assert photo.id == "wm001"
    assert photo.place_name == "Kyoto, Japan"
    assert photo.location.lat == 35.0 and photo.location.lon == 135.7
    assert photo.license == "CC BY-SA 4.0"
    assert photo.country == "JP"


@pytest.mark.parametrize(
    "replace, expected",
    [
        (("CC BY-SA 4.0", "CC BY-NC 4.0"), "not an allowed open license"),
        (("CC BY-SA 4.0", "CC BY-ND 4.0"), "not an allowed open license"),
        (("35.0", "95.0"), "bad coordinates"),
        (("35.0", "north"), "bad coordinates"),
        (("https://example.org/a.jpg", "http://example.org/a.jpg"), "must be an https URL"),
        ((",JP,", ",Japan,"), "ISO 3166-1"),
        (("wm001", "WM 001"), "invalid id"),
        ((",Ann,", ",,"), "missing author"),
    ],
)
def test_rejects_bad_rows_with_the_row_number(tmp_path, replace, expected):
    old, new = replace
    with pytest.raises(CatalogError, match=expected) as exc:
        load_catalog(write(tmp_path, GOOD.replace(old, new, 1)))
    assert "row 2" in str(exc.value)


def test_rejects_duplicate_ids(tmp_path):
    with pytest.raises(CatalogError, match="duplicate id"):
        load_catalog(write(tmp_path, GOOD + GOOD))


def test_rejects_missing_columns(tmp_path):
    with pytest.raises(CatalogError, match="header is missing columns: license"):
        load_catalog(write(tmp_path, "", header=HEADER.replace(",license", "")))


def test_rejects_empty_catalog(tmp_path):
    with pytest.raises(CatalogError, match="empty"):
        load_catalog(write(tmp_path, ""))


class TestRealCatalog:
    """The committed catalog must always load and stay balanced."""

    def test_loads(self):
        photos = load_catalog(REAL_CATALOG)
        assert len(photos) >= 50

    def test_spans_many_countries_and_every_inhabited_continent(self):
        photos = load_catalog(REAL_CATALOG)
        assert len({p.country for p in photos}) >= 40
        lats = [p.location.lat for p in photos]
        lons = [p.location.lon for p in photos]
        assert min(lats) < -30 and max(lats) > 60
        assert min(lons) < -100 and max(lons) > 140

    def test_every_photo_is_attributed(self):
        for p in load_catalog(REAL_CATALOG):
            assert p.attribution and p.source_url and p.license
