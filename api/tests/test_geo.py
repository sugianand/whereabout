import math

import pytest

from whereabout_api.geo import (
    EARTH_RADIUS_KM,
    MAX_POINTS,
    LatLon,
    haversine_km,
    score_distance,
    within_thresholds,
)

LONDON = LatLon(51.5074, -0.1278)
PARIS = LatLon(48.8566, 2.3522)
NEW_YORK = LatLon(40.7128, -74.0060)
LOS_ANGELES = LatLon(34.0522, -118.2437)


class TestHaversine:
    def test_same_point_is_zero(self):
        assert haversine_km(LONDON, LONDON) == 0.0

    def test_london_paris(self):
        # Widely quoted great-circle distance is ~344 km.
        assert haversine_km(LONDON, PARIS) == pytest.approx(343.5, abs=2)

    def test_new_york_los_angeles(self):
        assert haversine_km(NEW_YORK, LOS_ANGELES) == pytest.approx(3936, abs=10)

    def test_symmetric(self):
        assert haversine_km(LONDON, NEW_YORK) == pytest.approx(haversine_km(NEW_YORK, LONDON))

    def test_antipodes_are_half_the_circumference(self):
        d = haversine_km(LatLon(0, 0), LatLon(0, 180))
        assert d == pytest.approx(math.pi * EARTH_RADIUS_KM)

    def test_poles(self):
        d = haversine_km(LatLon(90, 0), LatLon(-90, 0))
        assert d == pytest.approx(math.pi * EARTH_RADIUS_KM)

    def test_crossing_the_antimeridian_is_short(self):
        # Two points either side of the 180° line, on the equator, ~22 km apart.
        d = haversine_km(LatLon(0, 179.9), LatLon(0, -179.9))
        assert d == pytest.approx(22.24, abs=0.1)


class TestValidation:
    @pytest.mark.parametrize(
        "lat, lon",
        [(91, 0), (-91, 0), (0, 181), (0, -181), (math.nan, 0), (0, math.inf)],
    )
    def test_invalid_coordinates_rejected(self, lat, lon):
        with pytest.raises(ValueError):
            LatLon(lat, lon)

    @pytest.mark.parametrize("lat, lon", [(90, 180), (-90, -180), (0, 0)])
    def test_boundary_coordinates_accepted(self, lat, lon):
        LatLon(lat, lon)


class TestScoring:
    def test_perfect_guess_gets_max_points(self):
        assert score_distance(0) == MAX_POINTS

    def test_score_decreases_with_distance(self):
        scores = [score_distance(d) for d in (0, 10, 100, 1000, 5000, 20000)]
        assert scores == sorted(scores, reverse=True)

    def test_far_side_of_planet_scores_almost_nothing(self):
        assert score_distance(math.pi * EARTH_RADIUS_KM) <= 1

    def test_scale_point(self):
        # At the scale distance the score is MAX_POINTS / e.
        assert score_distance(1500) == round(MAX_POINTS / math.e)

    @pytest.mark.parametrize("d", [-1, math.nan, math.inf])
    def test_invalid_distance_rejected(self, d):
        with pytest.raises(ValueError):
            score_distance(d)


def test_thresholds():
    hits = within_thresholds(150)
    assert hits == {1.0: False, 25.0: False, 200.0: True, 750.0: True, 2500.0: True}


def test_shared_fixture_matches():
    """The web app scores with a TypeScript copy of these functions; both check this file."""
    import json
    from pathlib import Path

    fixture = Path(__file__).resolve().parents[2] / "data" / "fixtures" / "geo_cases.json"
    cases = json.loads(fixture.read_text())["cases"]
    assert len(cases) >= 10
    for case in cases:
        a = LatLon(case["a"]["lat"], case["a"]["lon"])
        b = LatLon(case["b"]["lat"], case["b"]["lon"])
        d = haversine_km(a, b)
        assert d == pytest.approx(case["distance_km"], abs=1e-6), case["name"]
        assert score_distance(d) == case["score"], case["name"]
