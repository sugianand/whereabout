import csv

import numpy as np
import pytest

from whereabout_api.geo import LatLon, haversine_km
from whereabout_ml import split as sp


def synthetic(n, seed=1):
    rng = np.random.default_rng(seed)
    # Uniform on the sphere, so polar and antimeridian regions are exercised too.
    lat = np.degrees(np.arcsin(rng.uniform(-1, 1, n)))
    lon = rng.uniform(-180, 180, n)
    return [f"p{i}" for i in range(n)], [
        LatLon(float(a), float(b)) for a, b in zip(lat, lon, strict=True)
    ]


IDS, PTS = synthetic(4000)


def test_same_seed_same_split_and_different_seed_differs():
    a = sp.geo_split(IDS, PTS, seed=3)
    assert a == sp.geo_split(IDS, PTS, seed=3)
    assert a.labels != sp.geo_split(IDS, PTS, seed=4).labels


def test_whole_blocks_only():
    r = sp.geo_split(IDS, PTS, buffer_km=0)
    sides: dict[str, set[str]] = {}
    for block, label in zip(r.blocks, r.labels, strict=True):
        sides.setdefault(block, set()).add(label)
    assert all(len(s) == 1 for s in sides.values())
    assert set(r.labels) == {sp.TRAIN, sp.VAL}


def test_val_fraction_roughly_respected():
    r = sp.geo_split(IDS, PTS, val_frac=0.2, buffer_km=0, block_deg=5)
    frac = r.counts()[sp.VAL] / len(IDS)
    assert 0.1 < frac < 0.3


def test_val_frac_extremes():
    assert set(sp.geo_split(IDS, PTS, val_frac=0.0).labels) == {sp.TRAIN}
    assert set(sp.geo_split(IDS, PTS, val_frac=1.0).labels) == {sp.VAL}


def test_buffer_only_removes_train_photos_close_to_val():
    r = sp.geo_split(IDS, PTS, buffer_km=800)
    nobuf = sp.geo_split(IDS, PTS, buffer_km=0)
    assert r.counts()[sp.BUFFER] > 0
    val = [p for p, s in zip(PTS, r.labels, strict=True) if s == sp.VAL]
    for p, s, s0 in zip(PTS, r.labels, nobuf.labels, strict=True):
        if s0 == sp.VAL:
            assert s == sp.VAL  # validation photos are never relabelled
            continue
        near = any(haversine_km(p, v) < 800 for v in val)
        assert (s == sp.BUFFER) == near


def test_leakage_check_passes_on_produced_split():
    r = sp.geo_split(IDS, PTS, buffer_km=300)
    report = sp.check_split(r, PTS, 10.0, 300)
    assert report.ok and report.closest_km >= 300 and not report.shared_blocks


def test_leakage_check_fails_on_leaky_split():
    train, val = [LatLon(48.85, 2.35)], [LatLon(48.86, 2.36)]
    with pytest.raises(sp.LeakageError, match="closest"):
        sp.check_leakage(train, val, 50)
    report = sp.check_leakage(train, val, 50, raise_on_leak=False)
    assert not report.ok and report.closest_pair == (0, 0) and report.closest_km < 5


def test_leakage_check_flags_shared_block_even_if_far_apart():
    a, b = LatLon(1.0, 2.0), LatLon(8.0, 3.0)  # same 10-degree block, ~800 km apart
    assert sp.block_key(a.lat, a.lon, 10) == sp.block_key(b.lat, b.lon, 10)
    with pytest.raises(sp.LeakageError, match="shared blocks"):
        sp.check_leakage([a], [b], 50, block_deg=10)


def test_leakage_check_handles_empty_sides():
    assert sp.check_leakage([], [LatLon(0, 0)], 50).closest_km == float("inf")


def test_antimeridian():
    assert sp.block_key(0.0, 180.0, 10) == sp.block_key(0.0, -180.0, 10)
    east, west = LatLon(0.0, 179.9), LatLon(0.0, -179.9)  # ~22 km apart across the date line
    assert sp.block_key(0, 179.9, 10) != sp.block_key(0, -179.9, 10)
    saw_split = False
    for seed in range(200):
        r = sp.geo_split(["e", "w"], [east, west], seed=seed, buffer_km=50)
        if sp.VAL in r.labels and sp.TRAIN in r.labels:
            pytest.fail("neighbours across the date line were not buffered")
        saw_split |= sp.BUFFER in r.labels
    assert saw_split


def test_poles_do_not_crash():
    pts = [LatLon(90, 0), LatLon(90, 123), LatLon(-90, -180), LatLon(-90, 180), LatLon(89.99, 5)]
    r = sp.geo_split([str(i) for i in range(5)], pts, seed=1)
    assert len(r.labels) == 5
    assert r.blocks[0].split(":")[0] == r.blocks[1].split(":")[0] == r.blocks[4].split(":")[0]
    assert r.blocks[2] == r.blocks[3]  # -180 and 180 are the same meridian


def test_blocks_are_roughly_equal_area():
    def columns(lat):
        return max(int(sp.block_key(lat, lon, 10).split(":")[1]) for lon in range(-180, 180)) + 1

    assert columns(0.0) > 30 > columns(75.0) > columns(85.0)


def test_invalid_input():
    with pytest.raises(ValueError):
        sp.block_key(91, 0, 10)
    with pytest.raises(ValueError):
        sp.geo_split(["a"], [])


def test_cli_round_trip(tmp_path, capsys):
    ids, pts = synthetic(60, seed=5)
    cat = tmp_path / "photos.csv"
    with cat.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "image_url", "lat", "lon"])
        for i, p in zip(ids, pts, strict=True):
            w.writerow([i, "x", p.lat, p.lon])
    out = tmp_path / "out" / "split.csv"
    args = ["--catalog", str(cat), "--out", str(out), "--seed", "2", "--block-deg", "30"]
    assert sp.main(args) == 0
    assert "60 photos" in capsys.readouterr().out
    with out.open() as f:
        rows = list(csv.DictReader(f))
    assert [r["id"] for r in rows] == sorted(ids)
    expected = sp.geo_split(ids, pts, seed=2, block_deg=30)
    assert {r["id"]: r["split"] for r in rows} == dict(zip(ids, expected.labels, strict=True))
    first = out.read_text()
    sp.main(args)
    assert out.read_text() == first
