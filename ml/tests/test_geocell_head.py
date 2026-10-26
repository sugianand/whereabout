import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_ml import geocell_head as gh
from whereabout_ml.geocells import haversine_matrix
from whereabout_ml.retrieval import Reference
from whereabout_ml.zeroshot import Guess

# Four regions, two per country; each region's photos "look" like it (one embedding axis each).
REGIONS = [
    ("Kyoto", "JP", 35.0, 135.8),
    ("Sapporo", "JP", 43.1, 141.3),
    ("Lima", "PE", -12.0, -77.0),
    ("Cusco", "PE", -13.5, -72.0),
]


@pytest.fixture(autouse=True)
def small_cells(monkeypatch):
    monkeypatch.setattr(gh, "MAX_CELL_POINTS", 40)
    monkeypatch.setattr(gh, "MIN_CELL_POINTS", 5)
    monkeypatch.setattr(gh, "MIN_REFERENCES", 20)


def look(region: int, rng, noise=0.2, dim=8) -> np.ndarray:
    v = rng.normal(0, noise, size=dim)
    v[region] += 1.0
    return v


def references(rng, per_region=30):
    refs, x = [], []
    for k, (place, country, lat, lon) in enumerate(REGIONS):
        for j in range(per_region):
            refs.append(
                Reference(
                    f"{place}{j}",
                    lat + rng.normal(0, 0.2),
                    lon + rng.normal(0, 0.2),
                    country,
                    place,
                    f"author{j % 5}",
                    "https://x",
                )
            )
            x.append(look(k, rng))
    return refs, np.array(x)


def guess(lat, lon, country, city="Somewhere"):
    return Guess(lat, lon, city, country, 0.5, ((country, 0.5),), ())


def km(a: LatLon, lat: float, lon: float) -> float:
    return float(haversine_matrix([a.lat], [a.lon], [lat], [lon])[0, 0])


def test_the_head_alone_pins_each_photo_in_the_region_it_looks_like():
    rng = np.random.default_rng(0)
    refs, x = references(rng)
    head = gh.fit_head(refs, x, l2=1e-2, tau_km=100.0)
    for k, (place, country, lat, lon) in enumerate(REGIONS):
        pin = head.pin_anywhere(head.probabilities(look(k, rng)[None, :])[0])
        assert km(pin.at, lat, lon) < 100
        assert (pin.country, pin.name) == (country, place)


def test_the_pin_minimises_expected_distance_not_the_likeliest_cell(monkeypatch):
    rng = np.random.default_rng(1)
    monkeypatch.setattr(gh, "MAX_CELL_POINTS", 10)
    # Three places in a row near the equator, 45° apart: one cell each.
    refs = [
        Reference(f"r{lon}_{j}", 1.0, lon + rng.normal(0, 0.05), "XX", f"P{lon:g}", "a", "u")
        for lon in (5.0, 50.0, 95.0)
        for j in range(10)
    ]
    head = gh.fit_head(refs, rng.normal(size=(len(refs), 4)), l2=1e-2, tau_km=100.0)
    lons = np.array([c.centroid.lon for c in head.cells.cells])
    assert len(lons) == 3
    p = np.zeros(len(lons))
    west, middle, east = (int(np.argmin(np.abs(lons - t))) for t in (5, 50, 95))
    p[west], p[middle], p[east] = 0.45, 0.1, 0.45
    # Torn between the ends, the pin goes to the middle, which is near both.
    assert head.pin_anywhere(p).name == "P50"
    p[:] = 0
    p[west], p[east] = 0.3, 0.7
    assert head.pin_anywhere(p).name == "P95"


def test_within_the_country_the_pin_never_leaves_the_country_atlas_chose():
    rng = np.random.default_rng(2)
    refs, x = references(rng)
    head = gh.fit_head(refs, x, l2=1e-2, tau_km=100.0)
    lima_look = head.probabilities(look(2, rng)[None, :])[0]
    # The photo looks like Lima, but Atlas said Japan: the pin stays in Japan.
    assert head.pin_within(lima_look, "JP").country == "JP"
    cusco = head.pin_within(head.probabilities(look(3, rng)[None, :])[0], "PE")
    assert cusco.name == "Cusco" and km(cusco.at, -13.5, -72.0) < 50
    # A country with no (or too few) reference photos keeps Atlas's own pin.
    assert head.pin_within(lima_look, "FR") is None


def test_run_head_plays_only_when_it_clearly_beats_the_playing_pin():
    rng = np.random.default_rng(3)
    refs, x = references(rng)
    truth, game, bad, exact = [], [], [], []
    for k, (place, country, lat, lon) in enumerate(REGIONS * 10):
        k %= 4
        at = LatLon(lat + rng.normal(0, 0.2), lon + rng.normal(0, 0.2))
        truth.append(at)
        game.append(look(k, rng))
        # The playing system got the country but pinned the other region of it.
        other = REGIONS[k ^ 1]
        bad.append(guess(other[2], other[3], country))
        exact.append(guess(at.lat, at.lon, country, place))
    game = np.array(game)

    def errors(gs):
        return [km(t, g.lat, g.lon) for g, t in zip(gs, truth, strict=True)]

    run = gh.run_head(refs, x, game, bad, errors(bad), truth, iterations=200)
    assert run is not None and run.verdict.ships and run.moved == len(truth)
    assert all(g.country == b.country for g, b in zip(run.within, bad, strict=True))
    assert np.median(errors(run.within)) < 100

    run = gh.run_head(refs, x, game, exact, errors(exact), truth, iterations=200)
    assert not run.verdict.ships  # an exact pin cannot be clearly beaten

    record = gh.summary(run, versus="Atlas", model="Fake", n=len(truth))
    assert record["references"] == len(refs) and record["cells"] == len(run.head.cells)
    assert record["l2"] in gh.L2_GRID and record["tauKm"] in gh.TAU_GRID_KM
    assert record["ships"] is False and record["moved"] == len(truth)


def test_run_head_needs_enough_reference_photos(monkeypatch):
    rng = np.random.default_rng(4)
    refs, x = references(rng, per_region=4)
    g = [guess(0, 0, "JP")]
    assert gh.run_head(refs, x, x[:1], g, [1.0], [LatLon(0, 0)]) is None
    monkeypatch.setattr(gh, "MIN_REFERENCES", 1)
    with pytest.raises(ValueError):
        gh.run_head(refs, x, x[:2], g, [1.0], [LatLon(0, 0)])


def test_hyperparameters_come_from_the_grid():
    rng = np.random.default_rng(5)
    refs, x = references(rng, per_region=15)
    from whereabout_ml.geocells import Geocells

    cells = Geocells.build([LatLon(r.lat, r.lon) for r in refs], max_points=40, min_points=5)
    l2, tau = gh.select_hyperparameters(
        refs, x, cells, l2_grid=(1e-2, 1e-1), tau_grid_km=(50.0,), iterations=100
    )
    assert l2 in (1e-2, 1e-1) and tau == 50.0
