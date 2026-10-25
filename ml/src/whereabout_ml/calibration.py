"""Calibration: does "62% sure of the country" mean right about 62% of the time?

The reveal tells players how sure Atlas was of its top country. Zero-shot CLIP's softmax
(similarities scaled by its learned ~100) was never fitted to how often it is right on photos
like ours, so this module measures that and, if it helps, fixes it with temperature scaling
(Guo et al., 2017): one scalar T divides the country logits, so p = softmax(logits / T). T > 1
softens an overconfident model, T < 1 sharpens an underconfident one, and the ranking of
countries never changes, so Atlas's pin and every distance metric stay exactly as they were.

Fitting T on the same photos it is judged on would flatter it, so temperatures are cross-fitted:
photos are dealt into folds by the same geographic blocks as `whereabout_ml.split` (a whole block
lands in one fold, so a photo is never calibrated on its near-duplicates), and each photo's T is
fitted on the other folds. The calibrated probabilities ship only if their held-out negative log
likelihood is lower than the raw ones'.

Expected calibration error (ECE) is reported too: the gap between confidence and accuracy,
averaged over equal-width confidence bins and weighted by how many photos fall in each.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_ml.split import block_key

DEFAULT_FOLDS = 5
DEFAULT_BLOCK_DEG = 10.0
DEFAULT_BINS = 10
# Search range for T. Outside it the model is either uniform or one-hot, which no fit should need.
T_MIN, T_MAX = 0.05, 20.0
_GOLDEN = (math.sqrt(5) - 1) / 2


def log_softmax(logits: np.ndarray) -> np.ndarray:
    z = logits - logits.max(axis=-1, keepdims=True)
    return z - np.log(np.exp(z).sum(axis=-1, keepdims=True))


def softmax_t(logits: np.ndarray, temperature: float | np.ndarray) -> np.ndarray:
    """Row-wise softmax(logits / T); `temperature` is a scalar or one value per row."""
    t = np.asarray(temperature, dtype=np.float64)
    if t.ndim == 1:
        t = t[:, None]
    return np.exp(log_softmax(np.asarray(logits, dtype=np.float64) / t))


def nll(logits: np.ndarray, labels: np.ndarray, temperature: float | np.ndarray = 1.0) -> float:
    """Mean negative log likelihood of the true labels under softmax(logits / T)."""
    if len(labels) == 0:
        raise ValueError("no labelled rows")
    t = np.asarray(temperature, dtype=np.float64)
    if t.ndim == 1:
        t = t[:, None]
    lp = log_softmax(np.asarray(logits, dtype=np.float64) / t)
    return float(-lp[np.arange(len(labels)), labels].mean())


def fit_temperature(logits: np.ndarray, labels: np.ndarray, iters: int = 100) -> float:
    """The T in [T_MIN, T_MAX] that minimises NLL on these rows.

    NLL is convex in the inverse temperature 1/T (a log-sum-exp of linear functions minus a
    linear term), so a golden-section search over 1/T finds the global minimum.
    """
    logits = np.asarray(logits, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    if len(labels) == 0:
        raise ValueError("no labelled rows to fit a temperature on")
    a, b = 1.0 / T_MAX, 1.0 / T_MIN

    def loss(beta: float) -> float:
        return nll(logits, labels, 1.0 / beta)

    c, d = b - _GOLDEN * (b - a), a + _GOLDEN * (b - a)
    fc, fd = loss(c), loss(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - _GOLDEN * (b - a)
            fc = loss(c)
        else:
            a, c, fc = c, d, fd
            d = a + _GOLDEN * (b - a)
            fd = loss(d)
    return 1.0 / ((a + b) / 2)


def geo_folds(
    points: Sequence[LatLon],
    folds: int = DEFAULT_FOLDS,
    block_deg: float = DEFAULT_BLOCK_DEG,
    seed: int = 0,
) -> np.ndarray:
    """Fold index per photo, by a seeded hash of its geographic block (never by row order)."""
    if folds < 2:
        raise ValueError("need at least 2 folds")
    out = np.empty(len(points), dtype=np.int64)
    for i, p in enumerate(points):
        key = block_key(p.lat, p.lon, block_deg)
        digest = hashlib.sha256(f"{seed}:{key}".encode()).digest()
        out[i] = int.from_bytes(digest[:8], "big") % folds
    return out


def cross_fit_temperatures(logits: np.ndarray, labels: np.ndarray, fold: np.ndarray) -> np.ndarray:
    """One T per row, fitted on the labelled rows of every other fold.

    Rows with label -1 (a country the gazetteer lacks) get a T but never help fit one. A fold
    whose complement has no labelled rows keeps T = 1, the raw model.
    """
    labels = np.asarray(labels, dtype=np.int64)
    fold = np.asarray(fold, dtype=np.int64)
    out = np.ones(len(labels), dtype=np.float64)
    labelled = labels >= 0
    for f in np.unique(fold):
        train = labelled & (fold != f)
        if train.any():
            out[fold == f] = fit_temperature(logits[train], labels[train])
    return out


def reliability(
    confidence: Sequence[float], correct: Sequence[bool], bins: int = DEFAULT_BINS
) -> tuple[list[dict], float]:
    """Equal-width confidence bins (empty ones left out) and the expected calibration error."""
    conf = np.asarray(confidence, dtype=np.float64)
    hit = np.asarray(correct, dtype=np.float64)
    if len(conf) == 0:
        raise ValueError("no rows")
    which = np.minimum((conf * bins).astype(np.int64), bins - 1)
    rows, ece = [], 0.0
    for b in range(bins):
        mask = which == b
        n = int(mask.sum())
        if not n:
            continue
        mean_conf, acc = float(conf[mask].mean()), float(hit[mask].mean())
        ece += n / len(conf) * abs(mean_conf - acc)
        rows.append(
            {
                "lo": round(b / bins, 4),
                "hi": round((b + 1) / bins, 4),
                "n": n,
                "confidence": round(mean_conf, 4),
                "accuracy": round(acc, 4),
            }
        )
    return rows, float(ece)


def _report(logits: np.ndarray, labels: np.ndarray, t: float | np.ndarray) -> dict:
    p = softmax_t(logits, t)
    top = p.argmax(axis=1)
    bins, ece = reliability(p[np.arange(len(top)), top], top == labels)
    # max(0, ...): a certain, right model's NLL can come out as -1e-16 in floating point.
    return {"nll": round(max(0.0, nll(logits, labels, t)), 4), "ece": round(ece, 4), "bins": bins}


def calibrate(
    logits: np.ndarray,
    labels: Sequence[int],
    points: Sequence[LatLon],
    *,
    folds: int = DEFAULT_FOLDS,
    block_deg: float = DEFAULT_BLOCK_DEG,
    seed: int = 0,
) -> tuple[np.ndarray, dict]:
    """Per-photo temperatures to ship, and the record of how they were chosen.

    `logits` is photos × countries (CLIP's scaled similarities), `labels` each photo's true
    country index or -1. The temperatures returned are the cross-fitted ones if they lower
    held-out NLL, else all ones (the raw model ships). The summary compares both on the
    labelled photos, with the cross-fitted numbers measured only on photos left out of each fit.
    """
    logits = np.asarray(logits, dtype=np.float64)
    labels_arr = np.asarray(labels, dtype=np.int64)
    if logits.shape[0] != len(labels_arr) or len(labels_arr) != len(points):
        raise ValueError("logits, labels and points differ in length")
    fold = geo_folds(points, folds, block_deg, seed)
    crossed = cross_fit_temperatures(logits, labels_arr, fold)
    mask = labels_arr >= 0
    if not mask.any():
        raise ValueError("no photo has a country the model knows")
    raw = _report(logits[mask], labels_arr[mask], 1.0)
    held_out = _report(logits[mask], labels_arr[mask], crossed[mask])
    ships = nll(logits[mask], labels_arr[mask], crossed[mask]) < nll(
        logits[mask], labels_arr[mask], 1.0
    )
    summary = {
        "method": "temperature scaling",
        "n": int(mask.sum()),
        "folds": folds,
        "blockDeg": block_deg,
        # Fitted on every labelled photo: what the cross-fitted temperatures estimate.
        "temperature": round(fit_temperature(logits[mask], labels_arr[mask]), 4),
        "raw": raw,
        "calibrated": held_out,
        "ships": bool(ships),
    }
    return (crossed if ships else np.ones(len(labels_arr))), summary


# The bands of the players' reality check, "When Atlas is 60–80% sure, it names the right country
# in N of M photos": SURENESS_EDGES in web/src/lib/game/sureness.ts, which must stay equal.
SURENESS_EDGES = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)


def sureness_bands(confidence: Sequence[float], correct: Sequence[bool]) -> list[dict]:
    """Every band [lo, hi) (the top one closed at 1, empty ones kept): photos and how many right.

    The same counting as `surenessBands` in web/src/lib/game/sureness.ts, for confidences the
    game does not ship itself (Pocket Atlas's, from a different CLIP model than the one playing).
    """
    if len(confidence) != len(correct):
        raise ValueError("confidence and correct differ in length")
    bands = [
        {"lo": lo, "hi": hi, "n": 0, "right": 0}
        for lo, hi in zip(SURENESS_EDGES, SURENESS_EDGES[1:], strict=False)
    ]
    for c, hit in zip(confidence, correct, strict=True):
        if not math.isfinite(c):
            continue
        c = min(1.0, max(0.0, float(c)))
        i = next((k for k, hi in enumerate(SURENESS_EDGES[1:-1]) if c < hi), len(bands) - 1)
        bands[i]["n"] += 1
        bands[i]["right"] += int(bool(hit))
    return bands
