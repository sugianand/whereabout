"""Distillation: a country head for Pocket Atlas's small model, taught by the game's big one.

"Try Atlas on your photo" runs ViT-B/32 in the browser, while the game's Atlas plays ViT-L/14,
whose calibrated country probabilities are better. The browser cannot run the big model, but
it can run a small head on its own embeddings that has learned to say what the big model would
(docs/decisions/0008-distilled-country-head.md):

- **The teacher labels the reference photos.** Every reference photo (geotagged Commons files
  that are never game photos, past the retrieval leakage guard) is embedded by the playing
  model, and its country distribution, divided by the game's own fitted temperature, is the
  soft target. No human or map label is used: the head learns the teacher's beliefs, including
  its uncertainty between look-alike countries.
- **The student is a correction to zero-shot.** The student's logits are Pocket Atlas's own
  zero-shot country logits (divided by its temperature, exactly what the browser shows today)
  plus a linear probe on the unit-length ViT-B/32 embedding (`fit_soft_probe` with `offset`).
  The L2 penalty pulls the probe towards zero, so a heavily penalised student is today's Pocket
  Atlas, and every country keeps its text-prompt prior where the references say little.
- **Tuned on references, scored on unseen places.** The penalty is the one with the lowest
  held-out cross-entropy against the teacher over 10° geographic folds of the reference photos.
  Each game photo is then scored by a student fitted on reference photos from the *other*
  folds, so never on its own block, against the game photo's true country.
- **Ships only if it wins.** On the catalog photos whose country the gazetteer knows, the
  paired-bootstrap 95% interval of the per-photo negative log likelihood (student minus
  today's Pocket Atlas) must lie entirely below zero, top-1 accuracy must not drop, and the
  pin the student's countries lead to must not be clearly further away (the paired interval of
  the median distance difference must reach zero or below). Only then does the head fitted on
  every reference photo go to the browser.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_eval.metrics import paired_median_delta_ci
from whereabout_ml.calibration import (
    DEFAULT_BLOCK_DEG,
    DEFAULT_FOLDS,
    geo_folds,
    log_softmax,
    softmax_t,
    sureness_bands,
)
from whereabout_ml.clue_heads import (
    BOOTSTRAP_SAMPLES,
    FIT_ITERATIONS,
    Probe,
    export_probe,
    fit_soft_probe,
    paired_mean_ci,
)
from whereabout_ml.zeroshot import LOGIT_SCALE, normalise

# Penalties tried by cross-validation over the reference photos. The probe corrects a prior,
# so the grid reaches further towards "leave zero-shot alone" than the clue heads' does.
L2_GRID = (1e-2, 1e-1, 1.0)
MIN_REFERENCES = 200  # fewer reference photos than this and no student is fitted
SHORTLIST = 5  # the reveal's shortlist length, for the top-5 accuracy reported alongside


def zero_shot_logits(
    embeddings: np.ndarray, country_embeddings: np.ndarray, temperature: float
) -> np.ndarray:
    """Photos × countries: a locator's scaled similarities divided by its temperature, the
    logits whose softmax Pocket Atlas shows today."""
    if temperature <= 0:
        raise ValueError("temperature must be positive")
    images = normalise(np.asarray(embeddings, dtype=np.float64))
    return LOGIT_SCALE * images @ np.asarray(country_embeddings, dtype=np.float64).T / temperature


@dataclass(frozen=True)
class Student:
    """softmax(zero-shot logits / T + probe logits), all on the unit-length embedding."""

    codes: tuple[str, ...]
    country_embeddings: np.ndarray  # (countries, dimensions), the locator's text side
    temperature: float
    probe: Probe

    def log_probabilities(self, embeddings: np.ndarray) -> np.ndarray:
        x = normalise(np.asarray(embeddings, dtype=np.float64))
        prior = zero_shot_logits(x, self.country_embeddings, self.temperature)
        return log_softmax(prior + self.probe.logits(x))

    def probabilities(self, embeddings: np.ndarray) -> np.ndarray:
        return np.exp(self.log_probabilities(embeddings))


def fit_student(
    x: np.ndarray,
    prior: np.ndarray,
    targets: np.ndarray,
    codes: Sequence[str],
    l2: float,
    *,
    iterations: int = FIT_ITERATIONS,
) -> Probe:
    """The correction probe for unit-length embeddings `x` with zero-shot logits `prior`."""
    return fit_soft_probe(x, targets, codes, l2, iterations=iterations, offset=prior)


def _cross_entropy(log_p: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """Per-row cross-entropy of `targets` under `log_p` (0·log 0 counts as 0)."""
    return -(targets * np.where(targets > 0, log_p, 0.0)).sum(axis=1)


def select_l2(
    x: np.ndarray,
    prior: np.ndarray,
    targets: np.ndarray,
    fold: np.ndarray,
    codes: Sequence[str],
    grid: Sequence[float] = L2_GRID,
    *,
    iterations: int = FIT_ITERATIONS,
) -> float:
    """The penalty with the lowest held-out cross-entropy against the teacher, over the
    geographic folds of the reference photos (no game photo is looked at)."""
    best, best_loss = grid[0], np.inf
    for l2 in grid:
        losses = []
        for f in np.unique(fold):
            train, test = fold != f, fold == f
            if not train.any() or not test.any():
                continue
            probe = fit_student(
                x[train], prior[train], targets[train], codes, l2, iterations=iterations
            )
            log_p = log_softmax(prior[test] + probe.logits(x[test]))
            losses.append(_cross_entropy(log_p, targets[test]))
        if not losses:
            continue
        loss = float(np.concatenate(losses).mean())
        if loss < best_loss:
            best, best_loss = l2, loss
    return best


@dataclass(frozen=True)
class DistillRun:
    """A student cross-fitted on the game photos, and the one fitted on every reference."""

    student: Student
    references: int
    l2: float
    held_out: np.ndarray  # game photos × countries: log-probabilities from out-of-fold students
    base: np.ndarray  # game photos × countries: today's Pocket Atlas log-probabilities


def run_distillation(
    codes: Sequence[str],
    country_embeddings: np.ndarray,
    temperature: float,
    reference_embeddings: np.ndarray,
    reference_points: Sequence[LatLon],
    teacher_probabilities: np.ndarray,
    game_embeddings: np.ndarray,
    game_points: Sequence[LatLon],
    *,
    folds: int = DEFAULT_FOLDS,
    block_deg: float = DEFAULT_BLOCK_DEG,
    seed: int = 0,
    iterations: int = FIT_ITERATIONS,
    grid: Sequence[float] = L2_GRID,
) -> DistillRun | None:
    """Fit and cross-fit the student. None with fewer than `MIN_REFERENCES` reference photos.

    `country_embeddings` and `temperature` are Pocket Atlas's (its locator's text side and its
    fitted temperature); `teacher_probabilities` is one row per reference photo, over `codes`.
    """
    k = len(codes)
    x_ref = normalise(np.asarray(reference_embeddings, dtype=np.float64))
    x_game = normalise(np.asarray(game_embeddings, dtype=np.float64))
    targets = np.asarray(teacher_probabilities, dtype=np.float64)
    if np.asarray(country_embeddings).shape[0] != k or targets.ndim != 2 or targets.shape[1] != k:
        raise ValueError("need one country embedding and one target column per country code")
    if not (len(x_ref) == len(reference_points) == len(targets)):
        raise ValueError("one point and one target row per reference embedding")
    if len(x_game) != len(game_points):
        raise ValueError("one point per game embedding")
    if len(x_ref) < MIN_REFERENCES or len(x_game) == 0:
        return None

    prior_ref = zero_shot_logits(x_ref, country_embeddings, temperature)
    prior_game = zero_shot_logits(x_game, country_embeddings, temperature)
    fold_ref = geo_folds(reference_points, folds, block_deg, seed)
    fold_game = geo_folds(game_points, folds, block_deg, seed)
    l2 = select_l2(x_ref, prior_ref, targets, fold_ref, codes, grid, iterations=iterations)

    held_out = log_softmax(prior_game)  # a fold with no training photos outside it keeps today's
    for f in np.unique(fold_game):
        rows, train = fold_game == f, fold_ref != f
        if not train.any():
            continue
        probe = fit_student(
            x_ref[train], prior_ref[train], targets[train], codes, l2, iterations=iterations
        )
        held_out[rows] = log_softmax(prior_game[rows] + probe.logits(x_game[rows]))
    final = fit_student(x_ref, prior_ref, targets, codes, l2, iterations=iterations)
    student = Student(
        tuple(codes), np.asarray(country_embeddings, dtype=np.float64), temperature, final
    )
    return DistillRun(student, len(x_ref), l2, held_out, log_softmax(prior_game))


def teacher_probabilities(logits: np.ndarray, temperature: float) -> np.ndarray:
    """The teacher's calibrated country distribution: softmax(logits / T)."""
    return softmax_t(np.asarray(logits, dtype=np.float64), temperature)


def _scores(log_p: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per labelled photo: negative log likelihood of the true country, top-1 hit, top-5 hit."""
    rows = np.arange(len(labels))
    nll = -log_p[rows, labels]
    top = np.argsort(-log_p, axis=1, kind="stable")[:, :SHORTLIST]
    return nll, top[:, 0] == labels, (top == labels[:, None]).any(axis=1)


def summary(
    run: DistillRun,
    labels: Sequence[int],
    student_km: Sequence[float],
    base_km: Sequence[float],
    *,
    teacher: np.ndarray | None = None,
    model: str,
    teacher_model: str,
    teacher_temperature: float,
    versus: str,
    samples: int = BOOTSTRAP_SAMPLES,
    seed: int = 0,
) -> dict:
    """The record for `pocket-calibration.json` and the results page, with the verdict.

    `labels` index `run.student.codes` per game photo (-1 for a country the gazetteer lacks:
    left out of the probability scores, kept for the pin). `student_km` and `base_km` are each
    game photo's pin error with the student's countries leading the city step and with today's.
    `teacher`, the game Atlas's own calibrated log-probabilities on the same photos, is
    reported for context only. A shipping record carries the head as an affine map
    (`export_probe`) on the unit-length embedding, added to the zero-shot logits divided by
    `temperature`.
    """
    labels = np.asarray(labels, dtype=np.int64)
    if not (len(labels) == len(run.held_out) == len(student_km) == len(base_km)):
        raise ValueError("one label and two pin errors per game photo")
    known = labels >= 0
    if not known.any():
        raise ValueError("no game photo has a country the gazetteer knows")
    y = labels[known]
    s_nll, s_top1, s_top5 = _scores(run.held_out[known], y)
    b_nll, b_top1, b_top5 = _scores(run.base[known], y)
    nll_delta, nll_lo, nll_hi = paired_mean_ci(s_nll, b_nll, samples=samples, seed=seed)
    acc_delta, acc_lo, acc_hi = paired_mean_ci(s_top1, b_top1, samples=samples, seed=seed)
    km_delta, km_lo, km_hi = paired_median_delta_ci(list(student_km), list(base_km), seed=seed)
    moved = int((np.argmax(run.held_out, axis=1) != np.argmax(run.base, axis=1)).sum())
    ships = nll_hi < 0 and acc_delta >= 0 and km_lo <= 0

    held = np.exp(run.held_out[known])
    top = held.argmax(axis=1)
    out = {
        "model": model,
        "teacher": teacher_model,
        "teacherTemperature": round(float(teacher_temperature), 4),
        "versus": versus,
        "n": int(known.sum()),
        "pins": len(labels),
        "references": run.references,
        "l2": run.l2,
        "changedCountry": moved,
        "nll": round(float(s_nll.mean()), 4),
        "baseNll": round(float(b_nll.mean()), 4),
        "nllDelta": round(nll_delta, 4),
        "nllCi95": [round(nll_lo, 4), round(nll_hi, 4)],
        "accuracy": round(float(s_top1.mean()), 4),
        "baseAccuracy": round(float(b_top1.mean()), 4),
        "accuracyDelta": round(acc_delta, 4),
        "accuracyCi95": [round(acc_lo, 4), round(acc_hi, 4)],
        "top5Accuracy": round(float(s_top5.mean()), 4),
        "baseTop5Accuracy": round(float(b_top5.mean()), 4),
        "medianKmDelta": round(km_delta, 1),
        "kmCi95": [round(km_lo, 1), round(km_hi, 1)],
        # Held-out bands, so the browser's reality check would never count a photo its own
        # student was fitted with (the same counting as the zero-shot `sureness`).
        "sureness": sureness_bands(
            [float(held[i, top[i]]) for i in range(len(y))],
            [bool(top[i] == y[i]) for i in range(len(y))],
        ),
        "ships": bool(ships),
    }
    if teacher is not None:
        t_nll, t_top1, _ = _scores(np.asarray(teacher, dtype=np.float64)[known], y)
        out["teacherNll"] = round(float(t_nll.mean()), 4)
        out["teacherAccuracy"] = round(float(t_top1.mean()), 4)
    if ships:
        out["head"] = export_probe(run.student.probe)
    return out
