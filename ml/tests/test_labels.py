import csv
from pathlib import Path

import pytest

from whereabout_api.geo import LatLon
from whereabout_ml.gazetteer import City
from whereabout_ml.labels import (
    ISO_3166_ALPHA2,
    LEFT_HAND_TRAFFIC,
    NO_ROAD_TRAFFIC,
    NearestPlaceLocator,
    driving_side,
    driving_side_labels,
)

CATALOG = Path(__file__).resolve().parents[2] / "data" / "curation" / "photos.csv"


def city(name, country, lat, lon):
    return City(name=name, country=country, lat=lat, lon=lon, population=100_000)


# Real places at their real coordinates, chosen to sit on either side of the rule's borders.
PLACES = [
    city("London", "GB", 51.507, -0.128),
    city("Dover", "GB", 51.126, 1.316),
    city("Calais", "FR", 50.951, 1.858),
    city("Paris", "FR", 48.857, 2.352),
    city("Dublin", "IE", 53.350, -6.260),
    city("Belfast", "GB", 54.597, -5.930),
    city("Tokyo", "JP", 35.690, 139.692),
    city("Hong Kong", "HK", 22.320, 114.170),
    city("Shenzhen", "CN", 22.543, 114.058),
    city("Bangkok", "TH", 13.754, 100.501),
    city("Vientiane", "LA", 17.967, 102.600),
    city("Nairobi", "KE", -1.286, 36.817),
    city("Addis Ababa", "ET", 9.025, 38.747),
    city("New York", "US", 40.713, -74.006),
    city("Sydney", "AU", -33.869, 151.209),
]


def test_iso_table_is_complete_and_the_rule_tables_use_real_codes():
    assert len(ISO_3166_ALPHA2) == 249
    assert LEFT_HAND_TRAFFIC <= ISO_3166_ALPHA2
    assert NO_ROAD_TRAFFIC <= ISO_3166_ALPHA2
    assert not LEFT_HAND_TRAFFIC & NO_ROAD_TRAFFIC


@pytest.mark.parametrize(
    ("code", "side"),
    [
        ("GB", "left"),
        ("JP", "left"),
        ("IN", "left"),
        ("ZA", "left"),
        ("HK", "left"),
        ("WS", "left"),  # switched to the left in 2009
        ("FR", "right"),
        ("US", "right"),
        ("CN", "right"),
        ("MM", "right"),  # switched to the right in 1970
        ("RW", "right"),
        ("GI", "right"),  # British territory, but drives on the right like Spain
        ("gb", "left"),  # codes are case-insensitive
        (" jp ", "left"),
    ],
)
def test_driving_side_by_country(code, side):
    assert driving_side(code) == side


@pytest.mark.parametrize("code", [None, "", "XX", "UK", "GBR", "AQ", "IO"])
def test_unknown_codes_and_roadless_territories_get_no_label(code):
    assert driving_side(code) is None


def test_locator_finds_the_country_of_known_coordinates():
    locator = NearestPlaceLocator(PLACES)
    points = [
        LatLon(51.5, -0.1),  # central London
        LatLon(48.85, 2.29),  # Eiffel Tower
        LatLon(35.66, 139.70),  # Shibuya
        LatLon(22.28, 114.16),  # Hong Kong Central
        LatLon(22.55, 114.10),  # Shenzhen, just across the border
        LatLon(-33.86, 151.21),  # Sydney Opera House
    ]
    assert locator.countries(points) == ["GB", "FR", "JP", "HK", "CN", "AU"]


def test_driving_side_labels_across_rule_borders():
    labels = driving_side_labels(
        [
            LatLon(51.1, 1.3),  # Dover
            LatLon(50.95, 1.85),  # Calais, 40 km away across the Channel
            LatLon(22.28, 114.16),  # Hong Kong
            LatLon(22.55, 114.10),  # Shenzhen
            LatLon(13.75, 100.50),  # Bangkok
            LatLon(17.97, 102.60),  # Vientiane
        ],
        NearestPlaceLocator(PLACES),
    )
    assert labels == ["left", "right", "left", "right", "left", "right"]


def test_open_ocean_gets_no_label():
    locator = NearestPlaceLocator(PLACES, max_km=150)
    mid_atlantic, south_pacific = LatLon(30.0, -40.0), LatLon(-45.0, -130.0)
    assert locator.countries([mid_atlantic, south_pacific]) == [None, None]
    assert driving_side_labels([mid_atlantic], locator) == [None]


def test_max_km_is_the_cut_off():
    # Sydney to Canberra is about 250 km.
    canberra = LatLon(-35.28, 149.13)
    assert NearestPlaceLocator(PLACES, max_km=200).countries([canberra]) == [None]
    assert NearestPlaceLocator(PLACES, max_km=300).countries([canberra]) == ["AU"]


def test_chunking_does_not_change_answers():
    points = [LatLon(p.lat + 0.01, p.lon - 0.01) for p in PLACES] * 3
    one = NearestPlaceLocator(PLACES, chunk=1).countries(points)
    big = NearestPlaceLocator(PLACES, chunk=1000).countries(points)
    assert one == big == [p.country for p in PLACES] * 3


def test_empty_inputs():
    assert NearestPlaceLocator(PLACES).countries([]) == []
    with pytest.raises(ValueError):
        NearestPlaceLocator([])
    with pytest.raises(ValueError):
        NearestPlaceLocator(PLACES, max_km=0)


def test_every_catalog_photo_gets_a_driving_side():
    """The catalog's country column must be real codes with a known rule. A territory with no
    public road convention (NO_ROAD_TRAFFIC, e.g. South Georgia, which the Commons harvest
    reached) is a real place to photograph: it just has no driving side to learn."""
    with CATALOG.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert rows
    missing = {
        r["id"]: r["country"]
        for r in rows
        if driving_side(r["country"]) is None and r["country"] not in NO_ROAD_TRAFFIC
    }
    assert not missing
    assert all(r["country"] in ISO_3166_ALPHA2 for r in rows)
