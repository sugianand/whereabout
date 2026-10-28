"""Distillation, tested in a small world where the teacher knows something the student's
zero-shot prior gets wrong."""

import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_ml import distill
from whereabout_ml.calibration import geo_folds, log_softmax
from whereabout_ml.zeroshot import LOGIT_SCALE, normalise

CODES = ("AA", "BB", "CC", "DD")
DIM = 8


def world(n, rng):
    """`n` photos: a country each (scattered over the globe, so every 10° fold sees every
    country), a point, and an embedding pointing at the country's direction plus noise."""
    countries = rng.integers(0, len(CODES), size=n)
    points = [LatLon(float(rng.uniform(-50, 65)), float(rng.uniform(-180, 180))) for _ in range(n)]
    x = rng.normal(0, 0.35, size=(n, DIM))
    x[np.arange(n), countries] += 1.0
    return countries, points, normalise(x)


# The student's text side mixes up CC and DD; the teacher's does not.
TRUE_TEXT = np.eye(len(CODES), DIM)
STUDENT_TEXT = TRUE_TEXT[[0, 1, 3, 2]]


def teacher_targets(x):
    return distill.teacher_probabilities(LOGIT_SCALE * x @ TRUE_TEXT.T, 20.0)


@pytest.fixture(scope="module")
def fitted():
    rng = np.random.default_rng(7)
    ref_c, ref_p, ref_x = world(600, rng)
    game_c, game_p, game_x = world(200, rng)
    run = distill.run_distillation(
        CODES,
        STUDENT_TEXT,
        20.0,
        ref_x,
        ref_p,
        teacher_targets(ref_x),
        game_x,
        game_p,
        iterations=300,
        grid=(1e-3, 1e-1),
    )
    return run, game_c, game_x


def test_the_student_learns_what_its_prior_gets_wrong(fitted):
    run, game_c, game_x = fitted
    rows = np.arange(len(game_c))
    held_nll = -run.held_out[rows, game_c].mean()
    base_nll = -run.base[rows, game_c].mean()
    assert held_nll < base_nll - 0.5
    # Today's prior swaps CC and DD; the held-out student names them right.
    swapped = game_c >= 2
    assert (run.base[swapped].argmax(axis=1) == game_c[swapped]).mean() < 0.2
    assert (run.held_out[swapped].argmax(axis=1) == game_c[swapped]).mean() > 0.9
    # The head fitted on every reference photo agrees, and is a proper distribution.
    p = run.student.probabilities(game_x)
    assert np.allclose(p.sum(axis=1), 1.0)
    assert (p.argmax(axis=1) == game_c).mean() > 0.9


def test_base_is_todays_tempered_zero_shot(fitted):
    run, _, game_x = fitted
    expected = log_softmax(LOGIT_SCALE * game_x @ STUDENT_TEXT.T / 20.0)
    assert np.allclose(run.base, expected)


def test_a_game_photo_is_scored_by_a_student_that_never_saw_its_fold():
    rng = np.random.default_rng(11)
    ref_c, ref_p, ref_x = world(300, rng)
    game_c, game_p, game_x = world(40, rng)
    targets = teacher_targets(ref_x)
    kwargs = dict(iterations=100, grid=(1e-2,))
    a = distill.run_distillation(
        CODES, STUDENT_TEXT, 20.0, ref_x, ref_p, targets, game_x, game_p, **kwargs
    )
    # Scramble the teacher on every reference photo in fold 0: game photos in fold 0 must not
    # notice, and the others must.
    fold_ref = geo_folds(ref_p)
    fold_game = geo_folds(game_p)
    scrambled = targets.copy()
    scrambled[fold_ref == 0] = targets[fold_ref == 0][:, ::-1]
    b = distill.run_distillation(
        CODES, STUDENT_TEXT, 20.0, ref_x, ref_p, scrambled, game_x, game_p, **kwargs
    )
    assert (fold_game == 0).any() and (fold_game != 0).any()
    assert np.allclose(a.held_out[fold_game == 0], b.held_out[fold_game == 0])
    assert not np.allclose(a.held_out[fold_game != 0], b.held_out[fold_game != 0])


def test_too_few_reference_photos_fit_nothing():
    rng = np.random.default_rng(2)
    _, ref_p, ref_x = world(distill.MIN_REFERENCES - 1, rng)
    _, game_p, game_x = world(5, rng)
    assert (
        distill.run_distillation(
            CODES, STUDENT_TEXT, 1.0, ref_x, ref_p, teacher_targets(ref_x), game_x, game_p
        )
        is None
    )


def test_inputs_must_line_up():
    rng = np.random.default_rng(2)
    _, ref_p, ref_x = world(10, rng)
    with pytest.raises(ValueError):
        distill.run_distillation(
            CODES, STUDENT_TEXT, 1.0, ref_x, ref_p[:5], teacher_targets(ref_x), ref_x, ref_p
        )
    with pytest.raises(ValueError):
        distill.zero_shot_logits(ref_x, STUDENT_TEXT, 0.0)


def record(run, game_c, student_km, base_km, **kwargs):
    return distill.summary(
        run,
        game_c,
        student_km,
        base_km,
        model="Small/openai",
        teacher_model="Big/openai, country then city",
        teacher_temperature=1.17,
        versus="Small/openai, country then city",
        **kwargs,
    )


def test_a_clearly_better_student_ships_with_its_head_and_held_out_bands(fitted):
    run, game_c, _ = fitted
    km = [100.0] * len(game_c)
    out = record(run, game_c, km, km, teacher=run.held_out)
    assert out["ships"] is True
    assert out["nllCi95"][1] < 0 and out["accuracyDelta"] > 0
    assert out["n"] == out["pins"] == len(game_c) and out["references"] == 600
    assert out["l2"] in (1e-3, 1e-1)
    assert out["changedCountry"] > 0
    assert sum(b["n"] for b in out["sureness"]) == len(game_c)
    head = out["head"]
    assert head["classes"] == list(CODES)
    assert len(head["weights"]) == len(CODES) and len(head["weights"][0]) == DIM
    assert out["teacherNll"] == out["nll"]  # context only: here the "teacher" is the student


def test_the_exported_head_reproduces_the_student(fitted):
    """What the browser would run: zero-shot logits / T plus the affine head, on the
    unit-length embedding."""
    from whereabout_ml.clue_heads import export_probe

    run, _, game_x = fitted
    head = export_probe(run.student.probe)
    w, b = np.array(head["weights"]), np.array(head["bias"])
    logits = LOGIT_SCALE * game_x @ STUDENT_TEXT.T / run.student.temperature + game_x @ w.T + b
    assert np.allclose(log_softmax(logits), run.student.log_probabilities(game_x), atol=1e-4)


def test_a_student_whose_pins_move_clearly_further_away_does_not_ship(fitted):
    run, game_c, _ = fitted
    base_km = list(np.linspace(10, 50, len(game_c)))
    out = record(run, game_c, [k + 500 for k in base_km], base_km)
    assert out["nllCi95"][1] < 0 and out["kmCi95"][0] > 0
    assert out["ships"] is False and "head" not in out


def test_todays_pocket_atlas_cannot_beat_itself(fitted):
    run, game_c, _ = fitted
    same = distill.DistillRun(run.student, run.references, run.l2, run.base, run.base)
    km = [100.0] * len(game_c)
    out = record(same, game_c, km, km)
    assert out["nllDelta"] == 0 and out["ships"] is False


def test_photos_in_unknown_countries_count_for_the_pin_only(fitted):
    run, game_c, _ = fitted
    labels = game_c.copy()
    labels[:10] = -1
    km = [100.0] * len(game_c)
    out = record(run, labels, km, km)
    assert out["n"] == len(game_c) - 10 and out["pins"] == len(game_c)
    with pytest.raises(ValueError, match="gazetteer"):
        record(run, np.full(len(game_c), -1), km, km)
