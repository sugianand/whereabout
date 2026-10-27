"""Clue heads: small classifiers on frozen CLIP embeddings that read a concept from a photo.

Atlas v0's reveal clues are zero-shot: the photo is compared with a few text descriptions
("a photo of a dry desert landscape") and a clue is shown when one clearly wins. A clue head
learns the concept from examples instead (docs/architecture.md, "Clue heads"):

- **Labels from maps, not people.** Every reference photo (`data/reference/`, geotagged Commons
  files that are never game photos) is labelled by its coordinates: the Köppen-Geiger climate
  group from the 1 km map and the driving side from its country (`whereabout_ml.labels`,
  `whereabout_ml.maps`, written by `concept-labels --references`).
- **A linear probe.** Multinomial logistic regression on the standardised image embedding, with
  an L2 penalty. The encoder is frozen; only a (dimensions × classes) weight matrix is fitted,
  which a CPU runner does in seconds. The penalty is chosen from a fixed grid by geographic
  cross-validation over the reference photos alone, never by looking at game photos.
- **Scored on unseen places.** Game photos and reference photos are dealt into folds by the same
  10° geographic blocks (`calibration.geo_folds`). Each game photo is predicted by a probe fitted
  on reference photos from the *other* folds, so a probe never sees a reference photo from the
  block the game photo was taken in. The truth is the game photo's own map label
  (`data/labels/concept_labels.csv`).
- **Against what plays today.** For the climate group, today's zero-shot climate clue (its six
  scene descriptions mapped to Köppen groups by `ZERO_SHOT_CLIMATE`). For the driving side,
  which no zero-shot clue reads, the side of the road in the country Atlas guessed: what a player
  learns from Atlas's guess anyway. Both are scored on every labelled photo (top choice, no
  abstaining), as is the probe.
- **Ships only if it wins.** A paired bootstrap of the accuracy difference on the same photos
  must put its whole 95% interval above zero. Then the probe fitted on every reference photo
  writes that concept's clue at the reveal (replacing the zero-shot climate clue, or adding a
  driving-side clue); otherwise the reveal keeps what it had.
"""

from __future__ import annotations

import csv
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_ml.calibration import DEFAULT_BLOCK_DEG, DEFAULT_FOLDS, geo_folds, log_softmax
from whereabout_ml.clues import MIN_CLUE_PROBABILITY
from whereabout_ml.zeroshot import Clue, Guess

# Penalties tried by cross-validation over the reference photos (on standardised features).
L2_GRID = (1e-3, 1e-2, 1e-1)
FIT_ITERATIONS = 400
MIN_TRAINING_PHOTOS = 50
BOOTSTRAP_SAMPLES = 2000

# Today's zero-shot climate options (`clues.CONCEPT_GROUPS`) read as main Köppen groups. Snowy
# landscapes are mostly continental (D) climates; "Arctic tundra" is polar (ET).
ZERO_SHOT_CLIMATE: dict[str, str] = {
    "Tropical": "Tropical",
    "Desert": "Arid",
    "Temperate": "Temperate",
    "Mediterranean": "Temperate",
    "Snow and ice": "Continental",
    "Arctic": "Polar",
}


@dataclass(frozen=True, slots=True)
class Concept:
    """A concept a clue head reads: the labels column, the reveal clue group it writes, its
    classes and how a predicted class reads as a clue."""

    name: str
    group: str
    classes: tuple[str, ...]
    clue: str  # format string for the class
    baseline: str  # what the head is compared with, in words


DRIVING_SIDE = Concept(
    "driving_side",
    "driving_side",
    ("left", "right"),
    "Drives on the {}",
    "the driving side of the country Atlas guessed",
)
CLIMATE_GROUP = Concept(
    "climate_group",
    "climate",
    ("Tropical", "Arid", "Temperate", "Continental", "Polar"),
    "{} climate",
    "the zero-shot climate clue",
)
CONCEPTS: tuple[Concept, ...] = (DRIVING_SIDE, CLIMATE_GROUP)


@dataclass(frozen=True)
class Probe:
    """Multinomial logistic regression over standardised embeddings."""

    classes: tuple[str, ...]
    mean: np.ndarray
    scale: np.ndarray
    weights: np.ndarray  # (dimensions, classes)
    bias: np.ndarray  # (classes,)
    l2: float

    def log_probabilities(self, x: np.ndarray) -> np.ndarray:
        z = ((np.asarray(x, dtype=np.float64) - self.mean) / self.scale) @ self.weights
        return log_softmax(z + self.bias)

    def probabilities(self, x: np.ndarray) -> np.ndarray:
        return np.exp(self.log_probabilities(x))


def fit_probe(
    x: np.ndarray,
    y: np.ndarray,
    classes: Sequence[str],
    l2: float,
    *,
    iterations: int = FIT_ITERATIONS,
) -> Probe:
    """Fit on hard labels (class indices); see `fit_soft_probe`."""
    y = np.asarray(y, dtype=np.int64)
    k = len(classes)
    if len(y) and (y.min() < 0 or y.max() >= k):
        raise ValueError("labels must index classes")
    onehot = np.zeros((len(y), k))
    onehot[np.arange(len(y)), y] = 1.0
    return fit_soft_probe(x, onehot, classes, l2, iterations=iterations)


def fit_soft_probe(
    x: np.ndarray,
    targets: np.ndarray,
    classes: Sequence[str],
    l2: float,
    *,
    iterations: int = FIT_ITERATIONS,
) -> Probe:
    """Fit by Nesterov-accelerated gradient descent on mean cross-entropy against `targets`
    (one probability row per embedding) + l2/2·|W|².

    The loss is convex and, with l2 > 0, strongly convex in W. The step is 1/L with L an upper
    bound on its curvature: the softmax Hessian is at most 1/2 times the feature covariance
    whatever the targets, so L = λmax(X̃ᵀX̃/n)/2 + l2, X̃ the standardised features plus a
    constant column for the bias.
    """
    x = np.asarray(x, dtype=np.float64)
    targets = np.asarray(targets, dtype=np.float64)
    if x.ndim != 2 or targets.ndim != 2 or len(x) != len(targets) or len(x) == 0:
        raise ValueError("need one label per embedding row, and at least one row")
    if l2 <= 0:
        raise ValueError("l2 must be positive")
    k = len(classes)
    if targets.shape[1] != k:
        raise ValueError("one target column per class")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale < 1e-12] = 1.0
    xs = (x - mean) / scale
    n, d = xs.shape
    xb = np.hstack([xs, np.ones((n, 1))])
    lipschitz = 0.5 * float(np.linalg.eigvalsh(xb.T @ xb / n)[-1]) + l2
    step = 1.0 / lipschitz

    theta = np.zeros((d + 1, k))
    previous = theta
    momentum = (np.sqrt(lipschitz) - np.sqrt(l2)) / (np.sqrt(lipschitz) + np.sqrt(l2))
    for _ in range(iterations):
        look = theta + momentum * (theta - previous)
        z = xb @ look
        p = np.exp(log_softmax(z))
        grad = xb.T @ (p - targets) / n
        grad[:d] += l2 * look[:d]
        previous, theta = theta, look - step * grad
    return Probe(tuple(classes), mean, scale, theta[:d], theta[d], l2)


def _encode(labels: Sequence[str | None], classes: Sequence[str]) -> np.ndarray:
    """Class index per label; -1 for no label (or one outside `classes`)."""
    index = {c: i for i, c in enumerate(classes)}
    return np.array([index.get(lab, -1) if lab else -1 for lab in labels], dtype=np.int64)


def select_l2(
    x: np.ndarray,
    y: np.ndarray,
    fold: np.ndarray,
    classes: Sequence[str],
    grid: Sequence[float] = L2_GRID,
    *,
    iterations: int = FIT_ITERATIONS,
) -> float:
    """The penalty with the lowest held-out NLL over geographic folds of the training photos."""
    best, best_nll = grid[0], np.inf
    for l2 in grid:
        losses = []
        for f in np.unique(fold):
            train, test = fold != f, fold == f
            if len(np.unique(y[train])) < 2 or not test.any():
                continue
            probe = fit_probe(x[train], y[train], classes, l2, iterations=iterations)
            lp = probe.log_probabilities(x[test])
            losses.append(-lp[np.arange(test.sum()), y[test]])
        if not losses:
            continue
        loss = float(np.concatenate(losses).mean())
        if loss < best_nll:
            best, best_nll = l2, loss
    return best


def paired_accuracy_ci(
    a_correct: Sequence[bool],
    b_correct: Sequence[bool],
    *,
    samples: int = BOOTSTRAP_SAMPLES,
    seed: int = 0,
) -> tuple[float, float, float]:
    """Accuracy of a minus accuracy of b on the same photos, with a paired-bootstrap 95% CI."""
    a = np.asarray(a_correct, dtype=np.float64)
    b = np.asarray(b_correct, dtype=np.float64)
    if len(a) != len(b) or len(a) == 0:
        raise ValueError("need the same, non-zero number of photos for both")
    diff = a - b
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, len(diff), size=(samples, len(diff)))
    means = diff[draws].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(diff.mean()), float(lo), float(hi)


def cross_fit_predictions(
    x_train: np.ndarray,
    y_train: np.ndarray,
    fold_train: np.ndarray,
    x_game: np.ndarray,
    fold_game: np.ndarray,
    game_ok: np.ndarray,
    classes: Sequence[str],
    l2: float,
    *,
    iterations: int = FIT_ITERATIONS,
) -> np.ndarray:
    """Predicted class per game photo (-1 where unscored), each from a probe fitted only on
    training photos outside the game photo's fold, so never on its own geographic block."""
    predicted = np.full(len(x_game), -1, dtype=np.int64)
    for f in np.unique(fold_game[game_ok]):
        rows = game_ok & (fold_game == f)
        train = fold_train != f
        if len(np.unique(y_train[train])) < 2:
            continue  # these photos count as wrong: no probe can be fitted without their fold
        probe = fit_probe(x_train[train], y_train[train], classes, l2, iterations=iterations)
        predicted[rows] = probe.probabilities(x_game[rows]).argmax(axis=1)
    return predicted


@dataclass(frozen=True)
class HeadResult:
    """One concept's comparison, and the probe that writes its clue if it ships."""

    concept: Concept
    n: int  # labelled game photos scored
    references: int  # labelled reference photos the final probe was fitted on
    head_accuracy: float
    baseline_accuracy: float
    majority_accuracy: float  # always naming the commonest training class, for context
    delta: float
    ci95: tuple[float, float]
    l2: float
    probe: Probe

    @property
    def ships(self) -> bool:
        return self.ci95[0] > 0

    def as_dict(self, model: str) -> dict:
        return {
            "concept": self.concept.name,
            "clueGroup": self.concept.group,
            "classes": list(self.concept.classes),
            "baseline": self.concept.baseline,
            "model": model,
            "n": self.n,
            "references": self.references,
            "headAccuracy": round(self.head_accuracy, 4),
            "baselineAccuracy": round(self.baseline_accuracy, 4),
            "majorityAccuracy": round(self.majority_accuracy, 4),
            "accuracyDelta": round(self.delta, 4),
            "ci95": [round(x, 4) for x in self.ci95],
            "l2": self.l2,
            "ships": self.ships,
        }


def evaluate_head(
    concept: Concept,
    reference_embeddings: np.ndarray,
    reference_points: Sequence[LatLon],
    reference_labels: Sequence[str | None],
    game_embeddings: np.ndarray,
    game_points: Sequence[LatLon],
    game_labels: Sequence[str | None],
    baseline: Sequence[str | None],
    *,
    folds: int = DEFAULT_FOLDS,
    block_deg: float = DEFAULT_BLOCK_DEG,
    seed: int = 0,
    iterations: int = FIT_ITERATIONS,
) -> HeadResult | None:
    """Cross-fitted accuracy of a probe for `concept` against `baseline` on the game photos.

    None when there is too little to fit or score (fewer than `MIN_TRAINING_PHOTOS` labelled
    reference photos, a single class, or no labelled game photo).
    """
    classes = concept.classes
    x_ref = np.asarray(reference_embeddings, dtype=np.float64)
    x_game = np.asarray(game_embeddings, dtype=np.float64)
    y_ref = _encode(reference_labels, classes)
    y_game = _encode(game_labels, classes)
    if not (len(x_ref) == len(reference_points) == len(y_ref)):
        raise ValueError("one point and one label per reference embedding")
    if not (len(x_game) == len(game_points) == len(y_game) == len(baseline)):
        raise ValueError("one point, label and baseline answer per game embedding")
    ref_ok = y_ref >= 0
    game_ok = y_game >= 0
    if ref_ok.sum() < MIN_TRAINING_PHOTOS or len(np.unique(y_ref[ref_ok])) < 2:
        return None
    if not game_ok.any():
        return None

    fold_ref = geo_folds(reference_points, folds, block_deg, seed)[ref_ok]
    fold_game = geo_folds(game_points, folds, block_deg, seed)
    x_train, y_train = x_ref[ref_ok], y_ref[ref_ok]
    l2 = select_l2(x_train, y_train, fold_ref, classes, iterations=iterations)

    predicted = cross_fit_predictions(
        x_train, y_train, fold_ref, x_game, fold_game, game_ok, classes, l2, iterations=iterations
    )
    truth = y_game[game_ok]
    head_correct = predicted[game_ok] == truth
    base_correct = _encode(baseline, classes)[game_ok] == truth
    majority = Counter(y_train.tolist()).most_common(1)[0][0]
    delta, lo, hi = paired_accuracy_ci(head_correct, base_correct, seed=seed)
    final = fit_probe(x_train, y_train, classes, l2, iterations=iterations)
    return HeadResult(
        concept=concept,
        n=int(game_ok.sum()),
        references=int(ref_ok.sum()),
        head_accuracy=float(head_correct.mean()),
        baseline_accuracy=float(base_correct.mean()),
        majority_accuracy=float((truth == majority).mean()),
        delta=delta,
        ci95=(lo, hi),
        l2=l2,
        probe=final,
    )


def export_probe(probe: Probe) -> dict:
    """The probe as one affine map on the raw embedding, for a browser to run.

    Standardisation is folded in: z = W'x + b' with W' = W / scale and
    b' = b - (mean / scale) W, so `logits = weights @ x + bias`, one weight row per class, gives
    the same log-probabilities as `Probe.log_probabilities` up to rounding. Seven significant
    digits keep the logits within about 1e-5 of the fitted probe's on unit-length embeddings.
    """
    w = probe.weights / probe.scale[:, None]
    b = probe.bias - (probe.mean / probe.scale) @ probe.weights

    def r(v: float) -> float:
        return float(f"{v:.7g}")

    return {
        "classes": list(probe.classes),
        "weights": [[r(v) for v in row] for row in w.T],
        "bias": [r(v) for v in b],
    }


def zero_shot_climate_groups(climate_probabilities: Sequence[np.ndarray]) -> list[str]:
    """Today's zero-shot climate clue as a Köppen group: its top option, never abstaining."""
    from whereabout_ml.clues import CONCEPT_GROUPS

    options = next(g for g in CONCEPT_GROUPS if g.name == "climate").options
    return [ZERO_SHOT_CLIMATE[options[int(np.argmax(p))][0]] for p in climate_probabilities]


def apply_heads(
    guesses: Sequence[Guess], game_embeddings: np.ndarray, results: Sequence[HeadResult]
) -> list[Guess]:
    """Guesses whose clues come from every shipping head instead of that group's old source.

    A head's clue is shown, like a zero-shot one, only when its top class reaches
    `MIN_CLUE_PROBABILITY`; the old clue of that group is dropped either way, because the
    head was the more accurate reader of it.
    """
    shipping = [r for r in results if r.ships]
    if not shipping:
        return list(guesses)
    x = np.asarray(game_embeddings, dtype=np.float64)
    probabilities = {r.concept.name: r.probe.probabilities(x) for r in shipping}
    out = []
    for i, guess in enumerate(guesses):
        groups = {r.concept.group for r in shipping}
        clues = [c for c in guess.clues if c.group not in groups]
        for r in shipping:
            p = probabilities[r.concept.name][i]
            best = int(np.argmax(p))
            if p[best] >= MIN_CLUE_PROBABILITY:
                label = r.concept.clue.format(r.concept.classes[best])
                clues.append(Clue(label, float(p[best]), r.concept.group))
        out.append(replace(guess, clues=tuple(sorted(clues, key=lambda c: -c.p))))
    return out


def load_labels(path: Path) -> dict[str, dict[str, str]]:
    """{photo id: {column: label}} from a concept-labels CSV (empty cells stay empty)."""
    with path.open(newline="", encoding="utf-8") as fh:
        return {row["id"]: row for row in csv.DictReader(fh)}


def labels_for(
    ids: Sequence[str], table: Mapping[str, Mapping[str, str]], column: str
) -> list[str | None]:
    return [(table.get(i) or {}).get(column) or None for i in ids]
