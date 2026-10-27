"""Where Atlas looked: occlusion saliency over the image the model actually sees.

CLIP sees a square crop of each photo (resize the short side, crop the centre). We split that
square into a grid, grey out one cell at a time, and re-score the photo. A cell matters as much
as Atlas's belief in its chosen country drops without it:

    importance(cell) = log p(country | photo) − log p(country | photo with cell greyed out)

Occlusion is slow (one forward pass per cell) but model-agnostic and causal: it measures what
the prediction depends on, not where attention weights happen to be large.

Faithfulness is then tested, not assumed (a "deletion test"): grey out the k cells Atlas relied
on most and, separately, k random cells. If the map is faithful, the first hurts much more.

Everything here is numpy over already-preprocessed pixels; `score` is any function from a batch
of pixel arrays to one number per image, so tests use a toy scorer instead of a model.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

# 7 × 7 cells of 32 px over CLIP's 224 px input: fine enough to show a sign or a roof line,
# coarse enough to stay at 50 forward passes per photo.
DEFAULT_GRID = 7
# Bump when the method changes, so cached maps from the old method are not reused.
# 2: maps from before photos were turned upright by EXIF and OpenAI's weights used QuickGELU.
SALIENCY_VERSION = 2
DELETION_K = 5
DELETION_RANDOM_TRIALS = 3

# (N, C, H, W) pixels → (N,) scores, e.g. log-probability of the guessed country.
Scorer = Callable[[np.ndarray], np.ndarray]


@dataclass(frozen=True, slots=True)
class Saliency:
    grid: int
    # Row-major grid × grid importances scaled to [0, 1] (1 = the cell that mattered most).
    cells: tuple[float, ...]
    # The square CLIP saw, as (x, y, width, height) fractions of the original photo.
    crop: tuple[float, float, float, float]
    # Deletion test, as relative drops in p(country): top-k cells vs. random cells (mean).
    top_k_drop: float
    random_k_drop: float


def cell_bounds(size: int, grid: int) -> list[tuple[int, int]]:
    """Split [0, size) into `grid` contiguous spans that differ in length by at most 1."""
    if grid < 1 or grid > size:
        raise ValueError(f"grid must be between 1 and {size}, got {grid}")
    edges = np.linspace(0, size, grid + 1).round().astype(int)
    return [(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:], strict=True)]


def occlude(pixels: np.ndarray, cells: list[int], grid: int, fill: float = 0.0) -> np.ndarray:
    """A copy of (C, H, W) `pixels` with the given row-major cells set to `fill`.

    CLIP's inputs are normalised per channel, so 0 is the dataset's mean colour: a neutral grey,
    not a black hole that would itself look like a feature.
    """
    _, h, w = pixels.shape
    rows, cols = cell_bounds(h, grid), cell_bounds(w, grid)
    out = pixels.copy()
    for c in cells:
        if not 0 <= c < grid * grid:
            raise ValueError(f"cell {c} outside a {grid}×{grid} grid")
        (r0, r1), (c0, c1) = rows[c // grid], cols[c % grid]
        out[:, r0:r1, c0:c1] = fill
    return out


def occlusion_map(pixels: np.ndarray, score: Scorer, grid: int = DEFAULT_GRID) -> np.ndarray:
    """Raw importances, shape (grid, grid): how much the score falls when each cell is hidden."""
    base = float(score(pixels[None])[0])
    batch = np.stack([occlude(pixels, [c], grid) for c in range(grid * grid)])
    return (base - np.asarray(score(batch), dtype=np.float64)).reshape(grid, grid)


def normalise_map(raw: np.ndarray) -> np.ndarray:
    """Keep the cells that supported the guess (positive drops), scaled so the top one is 1."""
    pos = np.clip(raw, 0.0, None)
    peak = pos.max()
    return pos / peak if peak > 0 else np.zeros_like(pos)


def random_cells(
    rng: np.random.Generator,
    n_cells: int,
    k: int = DELETION_K,
    trials: int = DELETION_RANDOM_TRIALS,
) -> list[list[int]]:
    """`trials` sets of k distinct cells, each sorted: the deletion test's random baseline."""
    return [
        sorted(int(i) for i in rng.choice(n_cells, size=k, replace=False)) for _ in range(trials)
    ]


def top_cells(raw: np.ndarray, k: int = DELETION_K) -> list[int]:
    """The k cells whose hiding hurt most; ties go to the earlier cell (row-major)."""
    return [int(i) for i in np.argsort(-raw.ravel(), kind="stable")[:k]]


def deletion_drops(
    pixels: np.ndarray, raw: np.ndarray, prob: Scorer, randoms: list[list[int]], k: int = DELETION_K
) -> tuple[float, float]:
    """Relative drop in probability after hiding the top-k cells, and after each random set (mean).

    Split from `deletion_test` so the random sets can be given: the browser's port
    (web/src/lib/pocket/saliency.ts) draws its own, and the shared fixture pins both to the same.
    """
    grid = raw.shape[0]
    batch = np.stack(
        [
            pixels,
            occlude(pixels, top_cells(raw, k), grid),
            *(occlude(pixels, r, grid) for r in randoms),
        ]
    )
    p = np.asarray(prob(batch), dtype=np.float64)
    base = max(p[0], 1e-12)
    drops = (base - p[1:]) / base
    return float(drops[0]), float(drops[1:].mean())


def deletion_test(
    pixels: np.ndarray,
    raw: np.ndarray,
    prob: Scorer,
    rng: np.random.Generator,
    k: int = DELETION_K,
    trials: int = DELETION_RANDOM_TRIALS,
) -> tuple[float, float]:
    """Relative drop in probability after hiding the top-k cells, and after k random cells.

    `prob` returns probabilities (not logs). The random figure is the mean over `trials` draws.
    """
    randoms = random_cells(rng, raw.size, k, trials)
    return deletion_drops(pixels, raw, prob, randoms, k)


def centre_crop_box(width: int, height: int) -> tuple[float, float, float, float]:
    """The square that 'resize the short side, then centre-crop' keeps, as fractions."""
    if width <= 0 or height <= 0:
        raise ValueError("image size must be positive")
    side = min(width, height)
    return ((width - side) / 2 / width, (height - side) / 2 / height, side / width, side / height)


def explain(
    pixels: np.ndarray,
    crop: tuple[float, float, float, float],
    log_prob: Scorer,
    rng: np.random.Generator,
    grid: int = DEFAULT_GRID,
) -> Saliency:
    """Saliency map and deletion test for one photo, from its preprocessed pixels."""
    raw = occlusion_map(pixels, log_prob, grid)
    top, rand = deletion_test(pixels, raw, lambda b: np.exp(log_prob(b)), rng)
    return Saliency(
        grid=grid,
        cells=tuple(round(float(v), 3) for v in normalise_map(raw).ravel()),
        crop=tuple(round(v, 4) for v in crop),  # type: ignore[arg-type]
        top_k_drop=round(top, 4),
        random_k_drop=round(rand, 4),
    )


def summarise(maps: list[Saliency]) -> dict:
    """Deletion test across photos: is hiding what Atlas relied on worse than hiding at random?"""
    if not maps:
        return {"n": 0}
    top = np.array([m.top_k_drop for m in maps])
    rand = np.array([m.random_k_drop for m in maps])
    return {
        "n": len(maps),
        "k": DELETION_K,
        "grid": maps[0].grid,
        "mean_top_k_drop": round(float(top.mean()), 4),
        "mean_random_k_drop": round(float(rand.mean()), 4),
        "share_top_worse": round(float((top > rand).mean()), 4),
    }
