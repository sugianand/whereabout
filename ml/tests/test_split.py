"""Geographic-block train/validation split, including the leakage test."""

import random
from pathlib import Path

import pytest

from whereabout_api.catalog import load_catalog
from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_ml.split import (
    block_of,
    geographic_split,
    leaked_blocks,
    min_cross_distance_km,
)

CATALOG = Path(__file__).resolve().parents[2] / "data" / "curation" / "photos.csv"


def scattered(n: int, seed: int = 1) -> list[Photo]:
    rng = random.Random(seed)
    return [
        Photo(f"p{i}", LatLon(rng.uniform(-60, 70), rng.uniform(-180, 180)), f"place {i}")
        for i in range(n)
    ]


def clustered(n: int, centre: LatLon, spread_deg: float, seed: int = 2) -> list[Photo]:
    """Near-duplicate photos around one spot, like many shots of the same landmark."""
    rng = random.Random(seed)
    return [
        Photo(
            f"c{i}",
            LatLon(
                centre.lat + rng.uniform(-spread_deg, spread_deg),
                centre.lon + rng.uniform(-spread_deg, spread_deg),
            ),
            "cluster",
        )
        for i in range(n)
    ]


def test_block_of_covers_the_edges():
    assert block_of(LatLon(-90, -180), 1.0) == (0, 0)
    assert block_of(LatLon(90, 180), 1.0) == (179, 359)
    assert block_of(LatLon(0.5, 0.5), 1.0) == (90, 180)
    assert block_of(LatLon(0.5, 0.5), 10.0) == (9, 18)


@pytest.mark.parametrize("bad", [0.0, -1.0, 91.0, float("nan")])
def test_block_size_is_validated(bad):
    with pytest.raises(ValueError):
        block_of(LatLon(0, 0), bad)


def test_val_fraction_is_validated():
    with pytest.raises(ValueError):
        geographic_split(scattered(5), val_fraction=1.5)


def test_every_photo_lands_on_exactly_one_side():
    photos = scattered(500)
    split = geographic_split(photos, val_fraction=0.2)
    ids = [p.id for p in split.train + split.val]
    assert sorted(ids) == sorted(p.id for p in photos)


def test_no_block_leaks_across_the_split():
    photos = scattered(500) + clustered(200, LatLon(48.86, 2.35), 3.0)
    for block_deg in (0.5, 1.0, 5.0):
        split = geographic_split(photos, val_fraction=0.3, block_deg=block_deg, seed=7)
        assert split.train and split.val
        assert leaked_blocks(split) == set()


def test_near_duplicates_stay_together():
    # 50 shots within ~1 km of one landmark, inside a single 1° block.
    landmark = clustered(50, LatLon(35.6586, 139.7454), 0.005)
    split = geographic_split(landmark + scattered(300), val_fraction=0.5)
    sides = {"val" if p in split.val else "train" for p in landmark}
    assert len(sides) == 1


def test_a_random_split_would_have_leaked():
    # Guards the test above: the same photos split at random put a landmark on both sides.
    landmark = clustered(50, LatLon(35.6586, 139.7454), 0.005)
    rng = random.Random(0)
    val = [p for p in landmark if rng.random() < 0.5]
    assert 0 < len(val) < len(landmark)


def test_split_is_deterministic_and_stable_when_photos_are_added():
    photos = scattered(300)
    a = geographic_split(photos, seed=3)
    b = geographic_split(photos, seed=3)
    assert a == b
    grown = geographic_split(photos + scattered(100, seed=99), seed=3)
    assert set(a.val) <= set(grown.val)
    assert set(a.train) <= set(grown.train)


def test_seed_changes_the_split():
    photos = scattered(300)
    assert geographic_split(photos, seed=0).val != geographic_split(photos, seed=1).val


def test_val_fraction_is_roughly_honoured_over_many_blocks():
    split = geographic_split(scattered(4000), val_fraction=0.2, block_deg=5.0)
    assert 0.15 < split.val_fraction < 0.25


def test_extreme_fractions():
    photos = scattered(50)
    assert geographic_split(photos, val_fraction=0.0).val == ()
    assert geographic_split(photos, val_fraction=1.0).train == ()


def test_min_cross_distance():
    a = Photo("a", LatLon(0.5, 0.5), "a")
    b = Photo("b", LatLon(0.5, 1.5), "b")
    split = geographic_split([a, b], val_fraction=0.5, seed=1)  # seed 1 separates them
    assert split.train == (a,) and split.val == (b,)
    assert min_cross_distance_km(split) == pytest.approx(111.2, abs=0.5)
    assert min_cross_distance_km(geographic_split([a], val_fraction=0.0)) is None


def test_catalog_split_has_no_leakage():
    photos = load_catalog(CATALOG)
    split = geographic_split(photos, val_fraction=0.2)
    assert len(split.train) + len(split.val) == len(photos)
    assert leaked_blocks(split) == set()
