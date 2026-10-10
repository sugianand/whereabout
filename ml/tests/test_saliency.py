"""Occlusion saliency with a toy scorer whose answer is known: no model, no weights."""

import numpy as np
import pytest

from whereabout_ml.saliency import (
    Saliency,
    cell_bounds,
    centre_crop_box,
    deletion_test,
    explain,
    normalise_map,
    occlude,
    occlusion_map,
    summarise,
)

GRID = 7
SIZE = 224
# The toy "model" only looks at one cell: row 2, column 5.
HOT = 2 * GRID + 5


def photo() -> np.ndarray:
    px = np.zeros((3, SIZE, SIZE), dtype=np.float32)
    rows, cols = cell_bounds(SIZE, GRID), cell_bounds(SIZE, GRID)
    (r0, r1), (c0, c1) = rows[HOT // GRID], cols[HOT % GRID]
    px[:, r0:r1, c0:c1] = 1.0
    return px


def log_prob(batch: np.ndarray) -> np.ndarray:
    """Confidence grows with how much of the hot cell is visible; log of a value in (0, 1)."""
    visible = batch[:, 0].sum(axis=(1, 2)) / (32 * 32)
    return np.log(0.05 + 0.9 * visible)


def test_cells_cover_the_image_exactly_once():
    spans = cell_bounds(224, 7)
    assert spans[0][0] == 0 and spans[-1][1] == 224
    assert all(a[1] == b[0] for a, b in zip(spans, spans[1:], strict=False))
    assert {b - a for a, b in cell_bounds(225, 7)} <= {32, 33}
    with pytest.raises(ValueError):
        cell_bounds(10, 0)


def test_occlude_greys_out_only_the_chosen_cells():
    px = np.ones((3, SIZE, SIZE), dtype=np.float32)
    out = occlude(px, [0, GRID * GRID - 1], GRID)
    assert out[:, :32, :32].max() == 0 and out[:, -32:, -32:].max() == 0
    assert out[:, 100:120, 100:120].min() == 1
    assert px.min() == 1, "the input must not be modified"
    with pytest.raises(ValueError):
        occlude(px, [GRID * GRID], GRID)


def test_the_map_finds_the_one_cell_the_model_uses():
    raw = occlusion_map(photo(), log_prob, GRID)
    assert raw.shape == (GRID, GRID)
    norm = normalise_map(raw)
    assert norm.ravel()[HOT] == 1.0
    assert np.count_nonzero(norm) == 1


def test_a_map_with_nothing_supporting_the_guess_is_all_zero():
    assert not normalise_map(-np.ones((3, 3))).any()


def test_deletion_hurts_more_when_hiding_what_mattered():
    px = photo()
    raw = occlusion_map(px, log_prob, GRID)
    top, rand = deletion_test(px, raw, lambda b: np.exp(log_prob(b)), np.random.default_rng(0))
    assert top == pytest.approx((0.95 - 0.05) / 0.95)
    assert rand < top


def test_centre_crop_box():
    assert centre_crop_box(400, 200) == (0.25, 0.0, 0.5, 1.0)
    assert centre_crop_box(300, 600) == (0.0, 0.25, 1.0, 0.5)
    assert centre_crop_box(10, 10) == (0.0, 0.0, 1.0, 1.0)
    with pytest.raises(ValueError):
        centre_crop_box(0, 10)


def test_explain_and_summarise():
    s = explain(photo(), (0.1, 0.0, 0.8, 1.0), log_prob, np.random.default_rng(1), GRID)
    assert s.grid == GRID and len(s.cells) == GRID * GRID
    assert s.cells[HOT] == 1.0 and s.crop == (0.1, 0.0, 0.8, 1.0)
    weak = Saliency(GRID, s.cells, s.crop, top_k_drop=0.1, random_k_drop=0.2)
    summary = summarise([s, weak])
    assert summary["n"] == 2 and summary["k"] == 5
    assert summary["share_top_worse"] == 0.5
    assert summarise([]) == {"n": 0}
