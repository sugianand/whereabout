"""Driving-side labels derived from a photo's country."""

from pathlib import Path

import pytest

from whereabout_api.catalog import load_catalog
from whereabout_api.geo import LatLon
from whereabout_api.photos import DEV_PHOTOS, Photo
from whereabout_ml.labels import (
    LEFT_HAND_TRAFFIC,
    driving_side,
    label_balance,
    photo_driving_side,
)

CATALOG = Path(__file__).resolve().parents[2] / "data" / "curation" / "photos.csv"


@pytest.mark.parametrize(
    "country",
    ["GB", "IE", "JP", "IN", "TH", "ID", "ZA", "KE", "AU", "NZ", "JM", "GY", "SR", "MT", "CY"],
)
def test_left_hand_traffic_countries(country):
    assert driving_side(country) == "left"


@pytest.mark.parametrize(
    "country",
    ["US", "CA", "FR", "DE", "CN", "KR", "BR", "PE", "EG", "IS", "RU", "AR", "MX", "LA"],
)
def test_right_hand_traffic_countries(country):
    assert driving_side(country) == "right"


@pytest.mark.parametrize(
    ("country", "side"),
    [
        ("WS", "left"),  # Samoa switched to the left in 2009
        ("MM", "right"),  # Myanmar switched to the right in 1970
        ("RW", "right"),  # surrounded by left-hand traffic neighbours, but drives right
        ("BI", "right"),
        ("GI", "right"),  # Gibraltar, unlike the UK
        ("VI", "left"),  # US Virgin Islands, unlike the rest of the US
        ("HK", "left"),  # Hong Kong and Macau keep left; mainland China keeps right
        ("MO", "left"),
    ],
)
def test_edge_cases(country, side):
    assert driving_side(country) == side


def test_codes_are_normalised():
    assert driving_side(" gb ") == "left"
    assert driving_side("us") == "right"


@pytest.mark.parametrize("bad", ["", "G", "GBR", "U5", "United Kingdom", "--"])
def test_rejects_codes_that_are_not_alpha2(bad):
    with pytest.raises(ValueError, match="alpha-2"):
        driving_side(bad)


def test_left_hand_table_is_well_formed():
    assert all(len(c) == 2 and c.isalpha() and c.isupper() for c in LEFT_HAND_TRAFFIC)
    # A typo that drops or duplicates countries should not go unnoticed.
    assert 70 <= len(LEFT_HAND_TRAFFIC) <= 80


def test_photo_without_country_has_no_label():
    photo = Photo("p", LatLon(0.0, 0.0), "Nowhere")
    assert photo_driving_side(photo) is None


def test_label_balance_on_dev_photos():
    # Reykjavík and Cusco keep right; Kyoto, Cape Town and Queenstown keep left.
    assert label_balance(DEV_PHOTOS) == {"left": 3, "right": 2}


def test_every_catalog_photo_gets_a_label():
    photos = load_catalog(CATALOG)
    balance = label_balance(photos)
    assert balance["unknown"] == 0
    assert balance["left"] + balance["right"] == len(photos)
