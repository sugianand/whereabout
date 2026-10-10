import pytest

from whereabout_api.geo import MAX_POINTS, LatLon
from whereabout_eval.metrics import (
    Prediction,
    bootstrap_median_ci,
    evaluate,
    markdown_table,
    medoid,
    paired_median_delta_ci,
)

PARIS = LatLon(48.8566, 2.3522)
LONDON = LatLon(51.5074, -0.1278)  # ~344 km from Paris
NEW_YORK = LatLon(40.7128, -74.0060)  # ~5,837 km from Paris


def pred(i: str, predicted: LatLon, truth: LatLon = PARIS, pc=None, tc=None) -> Prediction:
    return Prediction(i, predicted, truth, pc, tc)


def test_perfect_predictions():
    r = evaluate([pred("a", PARIS), pred("b", PARIS)], bootstrap=False)
    assert r.n == 2
    assert all(v == 1.0 for v in r.accuracy_at_km.values())
    assert r.median_km == 0
    assert r.mean_score == MAX_POINTS


def test_threshold_accuracy_counts_each_band():
    preds = [pred("exact", PARIS), pred("london", LONDON), pred("nyc", NEW_YORK)]
    r = evaluate(preds, bootstrap=False)
    acc = r.accuracy_at_km
    assert acc[1.0] == pytest.approx(1 / 3)
    assert acc[200.0] == pytest.approx(1 / 3)
    assert acc[750.0] == pytest.approx(2 / 3)
    assert acc[2500.0] == pytest.approx(2 / 3)
    assert r.median_km == pytest.approx(343.5, abs=2)


def test_country_accuracy_ignores_items_without_labels():
    preds = [
        pred("a", PARIS, pc="FR", tc="FR"),
        pred("b", LONDON, pc="GB", tc="FR"),
        pred("c", PARIS),
    ]
    assert evaluate(preds, bootstrap=False).country_accuracy == pytest.approx(0.5)


def test_country_accuracy_is_none_without_any_labels():
    assert evaluate([pred("a", PARIS)], bootstrap=False).country_accuracy is None


def test_empty_input_is_an_error():
    with pytest.raises(ValueError):
        evaluate([])


def test_bootstrap_ci_brackets_the_median_and_is_deterministic():
    distances = [float(d) for d in range(1, 101)]
    lo, hi = bootstrap_median_ci(distances, seed=1)
    assert lo <= 50.5 <= hi
    assert (lo, hi) == bootstrap_median_ci(distances, seed=1)


def test_report_and_table_render():
    r = evaluate([pred("a", PARIS), pred("b", LONDON), pred("c", NEW_YORK)])
    d = r.as_dict()
    assert d["n"] == 3 and set(d["accuracy_at_km"]) == {"1", "25", "200", "750", "2500"}
    table = markdown_table({"baseline": r})
    assert table.splitlines()[2].startswith("| baseline | 3 |")


def test_paired_delta_detects_a_clear_difference():
    better = [10.0 + i for i in range(50)]
    worse = [1000.0 + i for i in range(50)]
    delta, lo, hi = paired_median_delta_ci(better, worse, seed=3)
    assert delta == pytest.approx(-990.0)
    assert lo <= delta <= hi < 0


def test_paired_delta_straddles_zero_for_identical_systems():
    d = [float(i) for i in range(1, 60)]
    delta, lo, hi = paired_median_delta_ci(d, list(d))
    assert delta == 0 and lo == 0 and hi == 0


def test_paired_delta_needs_matching_lists():
    with pytest.raises(ValueError):
        paired_median_delta_ci([1.0], [1.0, 2.0])


def test_medoid_picks_the_central_point():
    berlin = LatLon(52.52, 13.405)
    assert medoid([PARIS, LONDON, berlin, NEW_YORK]) in (PARIS, LONDON)
    assert medoid([PARIS]) == PARIS
    with pytest.raises(ValueError):
        medoid([])
