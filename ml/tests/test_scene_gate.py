"""The scene gate's maths with a stub encoder: hand-built embeddings, no model weights."""

import math

import numpy as np
import pytest

from whereabout_ml.scene_gate import (
    ACCEPT_PROMPTS,
    DEFAULT_THRESHOLDS,
    REASONS,
    REJECT_PROMPTS,
    SceneGate,
    calibrate,
    evaluate,
    probability,
    to_markdown,
)
from whereabout_ml.zeroshot import softmax

DIM = len(REASONS) + 1  # one axis per reason, plus one for "good photo"


class AxisEncoder:
    """Every prompt of a reason lands near that reason's axis (with a little per-prompt noise)."""

    def encode_texts(self, texts):
        rows = []
        for i, t in enumerate(texts):
            axis = next((j for j, r in enumerate(REASONS) if t in REJECT_PROMPTS[r]), DIM - 1)
            v = np.zeros(DIM)
            v[axis] = 1.0
            v[(axis + 1) % DIM] = 0.05 * (i % 3)
            rows.append(v * 3.0)  # unnormalised on purpose
        return np.array(rows)


def axis_image(axis, strength=1.0):
    v = np.zeros(DIM)
    v[DIM - 1] = 0.3  # a little "good photo" in every image
    v[axis] = max(strength, v[axis])
    return v


def test_scores_are_log_odds_and_peak_on_the_matching_reason():
    gate = SceneGate(AxisEncoder())
    embs = np.array([axis_image(j) for j in range(DIM)])
    scores = gate.score_embeddings(embs)
    for s in scores:
        assert set(s) == set(REASONS)
    for j, reason in enumerate(REASONS):
        assert scores[j][reason] > 0
        assert probability(scores[j][reason]) > 0.99
        assert scores[j][reason] == max(scores[j].values())
    # the "good photo" image is more like a good photo than like any reason
    assert max(scores[-1].values()) < 0
    assert max(probability(v) for v in scores[-1].values()) < 0.01


def test_score_is_the_logit_of_the_two_way_softmax():
    gate = SceneGate(AxisEncoder())
    rng = np.random.default_rng(0)
    embs = rng.normal(size=(5, DIM))
    images = embs / np.linalg.norm(embs, axis=1, keepdims=True)
    for image, s in zip(images, gate.score_embeddings(embs), strict=True):
        accept = float(gate.accept_embedding @ image)
        for r in REASONS:
            reject = float(gate.reject_embeddings[r] @ image)
            expected = softmax(gate.logit_scale * np.array([reject, accept]))[0]
            assert probability(s[r]) == pytest.approx(expected, rel=1e-9)


def test_probability_is_stable_at_large_magnitudes():
    assert probability(0.0) == 0.5
    assert probability(800.0) == 1.0
    assert probability(-800.0) == 0.0
    assert probability(2.0) + probability(-2.0) == pytest.approx(1.0)


def test_prompt_ensembling_averages_then_renormalises():
    gate = SceneGate(AxisEncoder())
    for r in REASONS:
        assert np.linalg.norm(gate.reject_embeddings[r]) == pytest.approx(1.0)
    assert np.linalg.norm(gate.accept_embedding) == pytest.approx(1.0)

    class Fixed:
        def encode_texts(self, texts):
            return np.array([[1.0, 0, 0, 0, 0], [0, 1.0, 0, 0, 0]] * 50)[: len(texts)]

    emb = SceneGate(Fixed()).accept_embedding
    n = len(ACCEPT_PROMPTS)
    expected = np.array([(n + 1) // 2, n // 2, 0, 0, 0], dtype=float)
    assert emb == pytest.approx(expected / np.linalg.norm(expected))


def test_judge_passes_and_lists_reasons_in_order():
    gate = SceneGate(AxisEncoder(), thresholds={r: 0.5 for r in REASONS})
    ok = gate.judge(dict.fromkeys(REASONS, 0.1))
    assert ok.passed and ok.reasons == ()
    bad = gate.judge({"people": 0.2, "indoor": 0.9, "text": 0.1, "not_photo": 0.7})
    assert not bad.passed
    assert bad.reasons == ("indoor", "not_photo")
    assert bad.scores["indoor"] == 0.9


def test_screen_end_to_end_and_threshold_is_inclusive():
    gate = SceneGate(AxisEncoder())
    verdicts = gate.screen(np.array([axis_image(DIM - 1), axis_image(1)]))
    assert verdicts[0].passed
    assert verdicts[1].reasons == ("indoor",)
    assert gate.judge(dict.fromkeys(REASONS, DEFAULT_THRESHOLDS["people"])).reasons == REASONS


def test_missing_thresholds_rejected():
    with pytest.raises(ValueError, match="missing"):
        SceneGate(AxisEncoder(), thresholds={"people": 0.5})


def test_calibrate_sits_just_above_max_keep_score():
    keep = [{r: v for r in REASONS} for v in (0.1, 0.2344, 0.05)]
    t = calibrate(keep)
    assert t == dict.fromkeys(REASONS, 0.235)
    assert all(s[r] < t[r] for s in keep for r in REASONS)


def test_calibrate_handles_per_reason_maxima_and_negative_scores():
    keep = [{"people": 12.3456, "indoor": -4.2, "text": 0.5, "not_photo": 0.0}]
    t = calibrate(keep)
    assert t["people"] == pytest.approx(12.346)
    assert t["indoor"] == pytest.approx(-4.199)
    assert t["text"] == pytest.approx(0.501)
    assert t["not_photo"] == pytest.approx(0.001)
    assert all(keep[0][r] < t[r] for r in REASONS)


def _logit(p):
    return math.log(p / (1 - p))


def test_near_certain_scores_stay_apart_in_log_odds():
    """Regression: keepers and rejects whose probabilities differ only past the fourth decimal
    (the first calibration run) used to share a threshold of 1.0, so nothing was caught."""
    keep = [dict.fromkeys(REASONS, _logit(0.999894))]
    rejects = [("indoor", dict.fromkeys(REASONS, _logit(0.999904)))]
    t = calibrate(keep)
    assert all(probability(t[r]) < 1.0 for r in REASONS)
    report = evaluate(keep, rejects, t)
    assert report["catalog"]["passed"] == 1
    assert report["rejects"]["indoor"]["caught_for_label"] == 1


def test_calibrate_rejects_non_finite_scores():
    with pytest.raises(ValueError, match="non-finite"):
        calibrate([{**dict.fromkeys(REASONS, 0.0), "text": math.inf}])


def test_calibrate_respects_max_false_reject():
    keep = [dict.fromkeys(REASONS, v / 10) for v in range(10)]  # 0.0 .. 0.9
    strict = calibrate(keep, 0.0)["people"]
    loose = calibrate(keep, 0.2)["people"]  # may reject the top 2 of 10
    assert strict == pytest.approx(0.901)
    assert loose == pytest.approx(0.701)
    assert calibrate([dict.fromkeys(REASONS, -v) for v in range(10)], 0.0)["people"] == 0.001
    rejected = sum(s["people"] >= loose for s in keep)
    assert rejected / len(keep) <= 0.2


@pytest.mark.parametrize("bad", [-0.1, 1.0, 2.0])
def test_calibrate_validates_max_false_reject(bad):
    with pytest.raises(ValueError, match="max_false_reject"):
        calibrate([dict.fromkeys(REASONS, 0.1)], bad)


def test_calibrate_needs_input():
    with pytest.raises(ValueError, match="at least one"):
        calibrate([])


def _scores(**kw):
    return {**dict.fromkeys(REASONS, 0.0), **kw}


def test_evaluate_counts():
    keep = [_scores(), _scores(text=0.8), _scores(people=0.6, text=0.9)]
    rejects = [
        ("people", _scores(people=0.9)),
        ("people", _scores(indoor=0.9)),
        ("people", _scores()),
        ("text", _scores(text=0.7)),
    ]
    report = evaluate(keep, rejects, dict.fromkeys(REASONS, 0.5))
    assert report["catalog"] == {
        "n": 3,
        "passed": 1,
        "rejected_by": {"people": 1, "indoor": 0, "text": 2, "not_photo": 0},
    }
    assert report["rejects"]["people"] == {"n": 3, "caught": 2, "caught_for_label": 1}
    assert report["rejects"]["text"] == {"n": 1, "caught": 1, "caught_for_label": 1}
    assert "indoor" not in report["rejects"]
    assert report["thresholds"]["people"] == 0.5


def test_markdown_contains_the_reports_counts():
    keep = [_scores()] * 7
    rejects = [("indoor", _scores(indoor=0.9))] * 4
    thresholds = {"people": 0.321, "indoor": 0.5, "text": 0.5, "not_photo": 0.5}
    md = to_markdown(evaluate(keep, rejects, thresholds))
    assert "7 of 7" in md
    assert "0.321" in md
    row = next(line for line in md.splitlines() if line.startswith("| indoor"))
    assert [c.strip() for c in row.strip("|").split("|")] == ["indoor", "0.5", "0", "4", "4", "4"]
    people = next(line for line in md.splitlines() if line.startswith("| people"))
    assert "| - | - | - |" in people


def test_evaluate_names_the_closest_keepers_per_reason():
    keep = [_scores(people=v, indoor=-v) for v in (1.0, 3.0, 2.0, 3.0, -1.0)]
    ids = ["a", "b", "c", "d", "e"]
    report = evaluate(keep, [], dict.fromkeys(REASONS, 5.0), keep_ids=ids)
    closest = report["catalog"]["closest"]
    assert [p["id"] for p in closest["people"]] == ["b", "d", "c"]  # ties broken by id
    assert [p["score"] for p in closest["people"]] == [3.0, 3.0, 2.0]
    assert [p["id"] for p in closest["indoor"]] == ["e", "a", "c"]
    assert set(closest) == set(REASONS)
    assert "closest" not in evaluate(keep, [], dict.fromkeys(REASONS, 5.0))["catalog"]


def test_evaluate_checks_keep_ids_length():
    with pytest.raises(ValueError, match="keep_ids"):
        evaluate([_scores()], [], dict.fromkeys(REASONS, 0.0), keep_ids=["a", "b"])


def test_markdown_lists_closest_keepers():
    keep = [_scores(indoor=9.152), _scores(indoor=1.0)]
    md = to_markdown(evaluate(keep, [], dict.fromkeys(REASONS, 9.153), keep_ids=["wm077", "x"]))
    assert "log-odds" in md
    assert "## Catalog photos closest to each threshold" in md
    row = next(line for line in md.splitlines() if line.startswith("| indoor | 9.153 | wm"))
    assert "wm077 (9.152), x (1.0)" in row
