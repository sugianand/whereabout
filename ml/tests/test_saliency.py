"""Occlusion saliency with a toy scorer whose answer is known: no model, no weights."""

import json
from pathlib import Path

import numpy as np
import pytest

from whereabout_ml.saliency import (
    DELETION_K,
    Saliency,
    cell_bounds,
    centre_crop_box,
    deletion_drops,
    deletion_test,
    explain,
    normalise_map,
    occlude,
    occlusion_map,
    random_cells,
    summarise,
    top_cells,
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


# The browser's port (web/src/lib/pocket/saliency.ts) is pinned to this file.
FIXTURE = Path(__file__).resolve().parents[2] / "data" / "fixtures" / "saliency_cases.json"
# A toy linear "model" small enough to write out: 3 countries over 3 × 10 × 10 pixels, on a 4 × 4
# grid so cells are 2 or 3 px (uneven, like any size the grid doesn't divide).
TOY_SHAPE, TOY_GRID, TOY_COUNTRIES, TOY_COUNTRY = (3, 10, 10), 4, 3, 1


def toy_scorer(weights: np.ndarray, country: int):
    """log softmax(weights · pixels)[country], for a batch."""

    def log_prob(batch: np.ndarray) -> np.ndarray:
        logits = batch.reshape(len(batch), -1) @ weights.reshape(len(weights), -1).T
        logits -= logits.max(axis=1, keepdims=True)
        return logits[:, country] - np.log(np.exp(logits).sum(axis=1))

    return log_prob


def fixture_from_toy() -> dict:
    rng = np.random.default_rng(7)
    pixels = rng.normal(size=TOY_SHAPE).round(3)
    weights = rng.normal(scale=0.05, size=(TOY_COUNTRIES, *TOY_SHAPE)).round(3)
    log_prob = toy_scorer(weights, TOY_COUNTRY)
    crop = centre_crop_box(640, 480)
    raw = occlusion_map(pixels, log_prob, TOY_GRID)
    randoms = random_cells(np.random.default_rng(0), TOY_GRID * TOY_GRID)
    s = explain(pixels, crop, log_prob, np.random.default_rng(0), TOY_GRID)
    return {
        "note": "Shared by ml/tests/test_saliency.py and web/src/lib/pocket/saliency.test.ts. "
        "Regenerate with `python ml/tests/test_saliency.py`.",
        "cellBounds": [
            {"size": size, "grid": grid, "expected": cell_bounds(size, grid)}
            # 5/2 and 10/4 land on .5: numpy rounds those to even, not up.
            for size, grid in [(224, 7), (225, 7), (5, 2), (10, 4), (7, 2)]
        ],
        "centreCrop": [
            {"width": w, "height": h, "expected": list(centre_crop_box(w, h))}
            for w, h in [(640, 480), (300, 600), (10, 10)]
        ],
        "model": {
            "shape": list(TOY_SHAPE),
            "grid": TOY_GRID,
            "country": TOY_COUNTRY,
            "pixels": pixels.ravel().tolist(),
            "weights": weights.reshape(TOY_COUNTRIES, -1).tolist(),
            "crop": list(crop),
            "randoms": randoms,
            "expected": {
                "raw": raw.ravel().tolist(),
                "top": top_cells(raw),
                "grid": s.grid,
                "cells": list(s.cells),
                "crop": list(s.crop),
                "topKDrop": s.top_k_drop,
                "randomKDrop": s.random_k_drop,
            },
        },
    }


def test_given_random_cells_reproduce_the_seeded_deletion_test():
    fx = fixture_from_toy()["model"]
    pixels = np.array(fx["pixels"]).reshape(fx["shape"])
    log_prob = toy_scorer(np.array(fx["weights"]).reshape(-1, *fx["shape"]), fx["country"])
    raw = np.array(fx["expected"]["raw"]).reshape(fx["grid"], fx["grid"])
    prob = lambda b: np.exp(log_prob(b))  # noqa: E731
    seeded = deletion_test(pixels, raw, prob, np.random.default_rng(0))
    assert deletion_drops(pixels, raw, prob, fx["randoms"]) == seeded
    assert all(len(set(r)) == DELETION_K and r == sorted(r) for r in fx["randoms"])
    # The toy model does lean on some cells: the test is not vacuous.
    assert fx["expected"]["topKDrop"] > fx["expected"]["randomKDrop"]


def same(a, b) -> bool:
    """Equal, but floats only to 1e-9: BLAS sums in a different order on another machine."""
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(map(same, a, b))
    if isinstance(a, float) or isinstance(b, float):
        return abs(a - b) <= 1e-9
    return a == b


def test_the_shared_fixture_is_current():
    assert same(json.loads(FIXTURE.read_text()), json.loads(json.dumps(fixture_from_toy())))
    assert not same({"x": [1.0]}, {"x": [1.0 + 1e-6]})


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(fixture_from_toy(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
