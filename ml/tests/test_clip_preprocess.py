"""open_clip's image preprocessing, written out so the browser can be pinned to it.

Pocket Atlas computes CLIP's input pixels itself (web/src/lib/pocket/preprocess.ts) instead of
letting transformers.js resize through a canvas, which barely antialiases a big photo and failed
the parity test. `clip_pixels` below is the reference: Pillow's bicubic resize of the short side,
torchvision's centre crop, and CLIP's normalisation. Where open_clip is installed, it is checked
against open_clip's own transform; the shared fixture pins the browser to it.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "fixtures" / "clip_preprocess_cases.json"
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def short_side_size(width: int, height: int, size: int) -> tuple[int, int]:
    """torchvision's Resize(size) on a PIL image: short side to `size`, long side truncated."""
    if width <= height:
        return size, int(size * height / width)
    return int(size * width / height), size


def resized(rgb: Image.Image, size: int) -> Image.Image:
    return rgb.resize(short_side_size(*rgb.size, size), Image.Resampling.BICUBIC)


def clip_pixels(rgb: Image.Image, size: int = 224) -> np.ndarray:
    """(3, size, size) float32, as open_clip's eval transform gives for an RGB PIL image."""
    small = resized(rgb, size)
    w, h = small.size
    top, left = int(round((h - size) / 2.0)), int(round((w - size) / 2.0))
    crop = np.asarray(small, dtype=np.uint8)[top : top + size, left : left + size]
    x = crop.astype(np.float32) / np.float32(255)
    return ((x - MEAN) / STD).transpose(2, 0, 1)


def toy_image(width: int, height: int, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    return Image.fromarray(rng.integers(0, 256, (height, width, 3), dtype=np.uint8))


# Down by a lot, down a little, up, square, very wide, and 23 × 14 → 13 × 8, whose crop offset
# lands on .5 (torchvision rounds that half to even).
CASES = [(61, 37, 8), (37, 61, 8), (5, 4, 8), (21, 21, 8), (160, 9, 6), (23, 14, 8), (90, 64, 6)]


def fixture_from_toy() -> dict:
    cases = []
    for i, (w, h, size) in enumerate(CASES):
        rgb = toy_image(w, h, i)
        cases.append(
            {
                "width": w,
                "height": h,
                "size": size,
                "rgb": np.asarray(rgb).ravel().tolist(),
                "resized": {
                    "width": resized(rgb, size).size[0],
                    "height": resized(rgb, size).size[1],
                    "rgb": np.asarray(resized(rgb, size)).ravel().tolist(),
                },
                "pixels": [round(float(v), 6) for v in clip_pixels(rgb, size).ravel()],
            }
        )
    return {
        "note": "Shared by ml/tests/test_clip_preprocess.py and "
        "web/src/lib/pocket/preprocess.test.ts. Regenerate with "
        "`python ml/tests/test_clip_preprocess.py`.",
        "cases": cases,
    }


def test_the_reference_is_open_clips_own_transform():
    open_clip = pytest.importorskip("open_clip")
    _, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained=None)
    for i, (w, h) in enumerate([(640, 427), (427, 640), (4032, 3024), (225, 300), (300, 300)]):
        rgb = toy_image(w, h, 100 + i)
        np.testing.assert_allclose(preprocess(rgb).numpy(), clip_pixels(rgb), rtol=0, atol=1e-6)


def test_the_crop_offset_rounds_half_to_even():
    small = resized(toy_image(23, 14, 0), 8)
    assert small.size == (13, 8)  # (13 - 8) / 2 = 2.5 → 2
    assert np.array_equal(
        clip_pixels(toy_image(23, 14, 0), 8)[0],
        clip_pixels(small.crop((2, 0, 10, 8)), 8)[0],
    )


def test_the_shared_fixture_is_current():
    want = json.loads(json.dumps(fixture_from_toy()))
    got = json.loads(FIXTURE.read_text())
    for g, w in zip(got["cases"], want["cases"], strict=True):
        assert {k: g[k] for k in ("width", "height", "size", "rgb", "resized")} == {
            k: w[k] for k in ("width", "height", "size", "rgb", "resized")
        }
        np.testing.assert_allclose(g["pixels"], w["pixels"], atol=2e-6)
    assert len(got["cases"]) == len(want["cases"])


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(fixture_from_toy()) + "\n")
    print(f"wrote {FIXTURE}")
