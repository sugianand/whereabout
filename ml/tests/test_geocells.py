import numpy as np
import pytest

from whereabout_api.geo import LatLon, haversine_km
from whereabout_ml.geocells import Geocells, haversine_matrix, soft_targets, spherical_mean

RNG = np.random.default_rng(7)


def cluster(lat, lon, n, spread=0.2):
    return [
        LatLon(float(a), float(b))
        for a, b in zip(lat + RNG.normal(0, spread, n), lon + RNG.normal(0, spread, n), strict=True)
    ]


PARIS = cluster(48.86, 2.35, 300)
TOKYO = cluster(35.68, 139.69, 120)
LONELY = cluster(-75.0, 0.0, 3)  # too few for a class of their own
POINTS = PARIS + TOKYO + LONELY


def test_dense_places_get_more_cells_and_sparse_ones_none():
    cells = Geocells.build(POINTS, max_points=100, min_points=20)
    assert sum(c.count for c in cells.cells) <= len(POINTS)
    keys = [c.key for c in cells.cells]
    assert len(set(keys)) == len(keys)
    near_paris = [c for c in cells.cells if haversine_km(c.centroid, LatLon(48.86, 2.35)) < 100]
    near_tokyo = [c for c in cells.cells if haversine_km(c.centroid, LatLon(35.68, 139.69)) < 100]
    assert len(near_paris) > len(near_tokyo) >= 1
    assert not [c for c in cells.cells if c.centroid.lat < -60]


def test_every_point_gets_a_class_even_if_its_cell_was_dropped():
    cells = Geocells.build(POINTS, max_points=100, min_points=20)
    labels = cells.assign(POINTS)
    assert labels.min() >= 0 and labels.max() < len(cells)
    # A point inside a kept cell is labelled with it; any other joins the nearest kept cell.
    clat, clon = cells.centroids
    inside_kept = 0
    for p, k in zip(POINTS, labels, strict=True):
        home = [i for i, c in enumerate(cells.cells) if Geocells._contains(c, p)]
        if home:
            inside_kept += 1
            assert k == home[0]
        else:
            assert k == np.argmin(haversine_matrix([p.lat], [p.lon], clat, clon)[0])
    assert inside_kept > len(POINTS) / 2
    # The lonely Antarctic points join whichever kept cell is nearest.
    lonely = cells.assign(LONELY)
    clat, clon = cells.centroids
    nearest = np.argmin(haversine_matrix([LONELY[0].lat], [LONELY[0].lon], clat, clon)[0])
    assert lonely[0] == nearest


def test_world_edges_belong_to_a_cell():
    cells = Geocells.build(
        [LatLon(90, 180)] * 30 + [LatLon(-90, -180)] * 30, max_points=10, min_points=5, max_depth=3
    )
    assert len(cells.assign([LatLon(90, 180), LatLon(-90, -180)])) == 2


def test_spherical_mean_handles_the_antimeridian():
    m = spherical_mean(np.array([0.0, 0.0]), np.array([179.0, -179.0]))
    assert abs(abs(m.lon) - 180) < 1e-6 and abs(m.lat) < 1e-6


def test_haversine_matrix_matches_the_scalar_one():
    a, b = [LatLon(51.5, -0.13), LatLon(-33.9, 18.4)], [LatLon(40.7, -74.0), LatLon(35.7, 139.7)]
    m = haversine_matrix(
        [p.lat for p in a], [p.lon for p in a], [p.lat for p in b], [p.lon for p in b]
    )
    for i, p in enumerate(a):
        for j, q in enumerate(b):
            assert m[i, j] == pytest.approx(haversine_km(p, q), rel=1e-9)


def test_round_trip_through_json():
    cells = Geocells.build(POINTS, max_points=100, min_points=20)
    again = Geocells.from_json(cells.to_json())
    assert [c.key for c in again.cells] == [c.key for c in cells.cells]
    assert np.array_equal(again.assign(POINTS), cells.assign(POINTS))


def test_soft_targets_favour_the_true_cell_and_its_neighbours():
    cells = Geocells.build(POINTS, max_points=100, min_points=20)
    q = soft_targets(cells, PARIS[:5] + TOKYO[:5], tau_km=75)
    assert np.allclose(q.sum(axis=1), 1)
    clat, clon = cells.centroids
    for row, p in zip(q, PARIS[:5] + TOKYO[:5], strict=True):
        far = haversine_matrix([p.lat], [p.lon], clat, clon)[0] > 5000
        assert row[far].sum() < 1e-6  # the other side of the world gets ~nothing
    # A smaller tau concentrates the label.
    sharp = soft_targets(cells, PARIS[:5], tau_km=5)
    assert sharp.max(axis=1).mean() > q[:5].max(axis=1).mean()
    with pytest.raises(ValueError):
        soft_targets(cells, PARIS[:1], tau_km=0)


def test_build_refuses_empty_or_hopeless_input():
    with pytest.raises(ValueError):
        Geocells.build([])
    with pytest.raises(ValueError):
        Geocells.build(LONELY, min_points=10)
