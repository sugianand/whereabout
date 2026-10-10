"""Where Atlas looked, through the runner: a fake pixel encoder, the real geolocator."""

from pathlib import Path

import numpy as np
from test_run_atlas_v0 import PHOTOS, RIGHT, systems
from test_zeroshot import GAZ, GROUPS, VOCAB, KeywordEncoder

from whereabout_ml.run_atlas_v0 import build_outputs, explain_photos, saliency_cache_path
from whereabout_ml.saliency import Saliency, cell_bounds
from whereabout_ml.zeroshot import ZeroShotGeolocator

GRID = 4
HOT = 1 * GRID + 2  # row 1, column 2


class PixelEncoder(KeywordEncoder):
    """Text like KeywordEncoder; an image 'is Peru' in proportion to how much of HOT is visible."""

    name = "fake/pixels"

    def __init__(self) -> None:
        super().__init__()
        self.pixel_batches = 0

    def load_pixels(self, path: Path):
        px = np.zeros((3, 64, 64), dtype=np.float32)
        (r0, r1), (c0, c1) = cell_bounds(64, GRID)[HOT // GRID], cell_bounds(64, GRID)[HOT % GRID]
        px[:, r0:r1, c0:c1] = 1.0
        return px, (0.125, 0.0, 0.75, 1.0)

    def encode_pixels(self, batch):
        self.pixel_batches += 1
        visible = batch[:, 0].sum(axis=(1, 2)) / (16 * 16)
        out = np.full((len(batch), len(VOCAB)), 1e-3)
        out[:, VOCAB.index("Japan")] = 0.05
        out[:, VOCAB.index("Peru")] = 0.05 + 0.1 * visible
        return out / np.linalg.norm(out, axis=1, keepdims=True)


def run(tmp_path, encoder, guesses=RIGHT):
    locator = ZeroShotGeolocator(encoder, GAZ, top_k_countries=2, concept_groups=GROUPS)
    paths = [tmp_path / f"{p.id}.jpg" for p in PHOTOS]
    return explain_photos(PHOTOS, paths, guesses, encoder, locator, tmp_path / "cache", GRID)


def test_maps_find_what_the_model_used_and_are_cached(tmp_path):
    enc = PixelEncoder()
    maps = run(tmp_path, enc)
    cusco = maps["cusco"]  # guessed Peru: the hot cell is what made it Peru
    assert cusco.cells[HOT] == 1.0
    assert cusco.top_k_drop > cusco.random_k_drop
    assert cusco.crop == (0.125, 0.0, 0.75, 1.0)
    assert saliency_cache_path(tmp_path / "cache", enc.name, "cusco", GRID).exists()

    again = PixelEncoder()
    assert run(tmp_path, again) == maps
    assert again.pixel_batches == 0, "a cached map must not run the model again"


def test_a_changed_guess_is_explained_afresh(tmp_path):
    run(tmp_path, PixelEncoder())
    flipped = [RIGHT[1], RIGHT[0]]  # now Kyoto is guessed as Peru and Cusco as Japan
    enc = PixelEncoder()
    run(tmp_path, enc, flipped)
    assert enc.pixel_batches > 0


def test_maps_ride_along_with_the_playing_systems_guesses():
    looked = Saliency(2, (1.0, 0.0, 0.5, 0.0), (0.0, 0.0, 1.0, 1.0), 0.6, 0.1)
    atlas, report, markdown = build_outputs(
        PHOTOS, systems(), now="2026-10-10T00:00:00+00:00", saliency={"kyoto": looked}
    )
    assert atlas["guesses"]["kyoto"]["looked"] == {
        "grid": 2,
        "crop": [0.0, 0.0, 1.0, 1.0],
        "cells": [1.0, 0.0, 0.5, 0.0],
    }
    assert "looked" not in atlas["guesses"]["cusco"]
    assert atlas["evaluation"]["saliency"]["mean_top_k_drop"] == 0.6
    assert report["saliency"]["share_top_worse"] == 1.0
    assert "Where Atlas looked: is the map faithful?" in markdown


def test_no_saliency_section_without_maps():
    atlas, report, markdown = build_outputs(PHOTOS, systems(), now="2026-10-10T00:00:00+00:00")
    assert "saliency" not in atlas["evaluation"]
    assert report["saliency"] is None
    assert "faithful" not in markdown
