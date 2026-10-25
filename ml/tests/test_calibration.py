"""Temperature scaling: fits, folds and the ship-only-if-better rule."""

import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_ml.calibration import (
    T_MAX,
    T_MIN,
    calibrate,
    cross_fit_temperatures,
    fit_temperature,
    geo_folds,
    nll,
    reliability,
    softmax_t,
)


def sample(n, true_t, classes=8, seed=0):
    """Logits whose labels are drawn from softmax(logits / true_t): calibrated at T = true_t."""
    rng = np.random.default_rng(seed)
    logits = rng.normal(0.0, 3.0, size=(n, classes))
    p = softmax_t(logits, true_t)
    labels = np.array([rng.choice(classes, p=row) for row in p])
    return logits, labels


def spread_points(n, seed=0):
    rng = np.random.default_rng(seed)
    return [LatLon(float(rng.uniform(-60, 70)), float(rng.uniform(-180, 180))) for _ in range(n)]


@pytest.mark.parametrize("true_t", [0.5, 1.0, 2.5])
def test_the_fit_recovers_the_temperature_the_labels_were_drawn_at(true_t):
    logits, labels = sample(4000, true_t)
    assert fit_temperature(logits, labels) == pytest.approx(true_t, rel=0.1)


def test_the_fitted_temperature_minimises_nll():
    logits, labels = sample(500, 2.0, seed=1)
    t = fit_temperature(logits, labels)
    for other in (t * 0.9, t * 1.1, 1.0):
        assert nll(logits, labels, t) <= nll(logits, labels, other) + 1e-9


def test_the_fit_stays_inside_its_range_when_the_data_wants_a_one_hot_model():
    logits = np.array([[5.0, 0.0], [0.0, 5.0]])
    assert fit_temperature(logits, np.array([0, 1])) == pytest.approx(T_MIN, rel=0.01)
    # Labels that disagree with every logit push towards a uniform model.
    assert fit_temperature(logits, np.array([1, 0])) == pytest.approx(T_MAX, rel=0.01)


def test_temperature_never_reorders_countries():
    logits, _ = sample(50, 1.0, seed=2)
    for t in (0.3, 1.0, 4.0):
        assert (softmax_t(logits, t).argmax(axis=1) == logits.argmax(axis=1)).all()


def test_folds_follow_geographic_blocks_not_rows():
    # Two photos a few km apart share a 10° block, so they always share a fold.
    near = [LatLon(48.85, 2.35), LatLon(48.86, 2.29)]
    far = spread_points(200)
    folds = geo_folds(near + far, 5)
    assert folds[0] == folds[1]
    assert set(folds) == set(range(5))
    # Shuffling the rows moves no photo to another fold.
    order = np.random.default_rng(0).permutation(len(far))
    shuffled = geo_folds([far[i] for i in order], 5)
    assert (shuffled == folds[2:][order]).all()


def test_each_photo_is_calibrated_without_its_own_fold():
    logits, labels = sample(300, 2.0, seed=3)
    fold = np.arange(300) % 3
    temps = cross_fit_temperatures(logits, labels, fold)
    for f in range(3):
        rest = fold != f
        assert temps[fold == f] == pytest.approx(fit_temperature(logits[rest], labels[rest]))


def test_photos_of_unknown_countries_never_help_fit():
    logits, labels = sample(200, 2.0, seed=4)
    fold = np.arange(200) % 2
    unknown = labels.copy()
    unknown[:50] = -1
    temps = cross_fit_temperatures(logits, unknown, fold)
    keep = unknown >= 0
    expected = fit_temperature(logits[keep & (fold == 1)], unknown[keep & (fold == 1)])
    assert temps[0] == pytest.approx(expected)


def test_a_fold_with_nothing_else_to_learn_from_keeps_the_raw_model():
    logits, labels = sample(10, 1.0)
    labels[5:] = -1
    fold = np.array([0] * 5 + [1] * 5)
    assert (cross_fit_temperatures(logits, labels, fold)[:5] == 1.0).all()


def test_reliability_bins_and_ece_by_hand():
    conf = [0.15, 0.15, 0.85, 0.85, 0.85, 0.85]
    right = [False, False, True, True, True, False]
    bins, ece = reliability(conf, right, bins=10)
    assert [(b["lo"], b["n"], b["accuracy"]) for b in bins] == [(0.1, 2, 0.0), (0.8, 4, 0.75)]
    # |0.15 - 0| weighted 2/6, plus |0.85 - 0.75| weighted 4/6.
    assert ece == pytest.approx(2 / 6 * 0.15 + 4 / 6 * 0.10)
    # Confidence 1.0 lands in the top bin, not an eleventh one.
    assert reliability([1.0], [True])[0][0]["hi"] == 1.0


def test_an_overconfident_model_is_calibrated_and_ships():
    # Labels drawn at T = 3, so the raw logits (T = 1) are far too sure of themselves.
    logits, labels = sample(1500, 3.0, seed=5)
    temps, summary = calibrate(logits, labels, spread_points(1500, seed=5))
    assert summary["ships"] is True
    assert summary["temperature"] == pytest.approx(3.0, rel=0.15)
    assert summary["calibrated"]["nll"] < summary["raw"]["nll"]
    assert summary["calibrated"]["ece"] < summary["raw"]["ece"]
    assert temps.min() > 2.0 and summary["n"] == 1500
    assert sum(b["n"] for b in summary["calibrated"]["bins"]) == 1500


def test_calibration_that_does_not_help_held_out_photos_does_not_ship():
    # One fold, all Japan, is sure and right; the other, all Peru, is sure and wrong. Each
    # fold's fit learns the opposite lesson, so held-out NLL gets worse and the raw model stays.
    logits = np.array([[4.0, 0.0]] * 20)
    labels = np.array([0] * 10 + [1] * 10)
    points = [LatLon(35.0, 135.7)] * 10 + [LatLon(-13.5, -72.0)] * 10
    folds = geo_folds(points, 2)
    assert folds[0] != folds[-1]  # the two places land in different folds with this seed
    temps, summary = calibrate(logits, labels, points, folds=2)
    assert summary["ships"] is False
    assert (temps == 1.0).all()


def test_calibrate_needs_aligned_inputs_and_some_known_country():
    logits, labels = sample(4, 1.0)
    with pytest.raises(ValueError):
        calibrate(logits, labels[:3], spread_points(4))
    with pytest.raises(ValueError):
        calibrate(logits, [-1] * 4, spread_points(4))
