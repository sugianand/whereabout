"""What CLIP is fed: upright photos, and OpenAI's weights with the activation they were trained on.

Both were found by Pocket Atlas's parity test: browsers turn a photo upright by its EXIF tag and
transformers.js runs OpenAI's CLIP with QuickGELU, while the Python side did neither.
"""

import sys
import types

import numpy as np
from PIL import Image

from whereabout_ml.clip_encoder import ClipEncoder, load_rgb, needs_quick_gelu


def test_a_photo_stored_sideways_is_read_upright(tmp_path):
    upright = np.zeros((40, 60, 3), dtype=np.uint8)
    upright[:10] = 255  # a white band along the top
    stored = Image.fromarray(upright).rotate(90, expand=True)  # what the camera wrote
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90° clockwise to display"
    path = tmp_path / "phone.jpg"
    stored.save(path, exif=exif, quality=95)

    rgb = load_rgb(path)
    assert rgb.mode == "RGB"
    assert rgb.size == (60, 40)
    top, bottom = np.asarray(rgb)[:5].mean(), np.asarray(rgb)[-5:].mean()
    assert top > 200 and bottom < 50


def test_a_photo_without_an_orientation_tag_is_unchanged(tmp_path):
    path = tmp_path / "plain.png"
    Image.new("L", (30, 20), 128).save(path)
    rgb = load_rgb(path)
    assert rgb.size == (30, 20) and rgb.mode == "RGB"


def test_only_openai_weights_get_quick_gelu():
    assert needs_quick_gelu("openai")
    assert not needs_quick_gelu("laion2b_s34b_b79k")


def fake_open_clip(calls):
    def create(name, pretrained, device, force_quick_gelu):
        calls.append({"name": name, "pretrained": pretrained, "quick_gelu": force_quick_gelu})
        model = types.SimpleNamespace(eval=lambda: None)
        return model, None, lambda img: img

    return types.SimpleNamespace(
        create_model_and_transforms=create, get_tokenizer=lambda name: lambda texts: texts
    )


def test_the_encoder_builds_openai_models_with_quick_gelu(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setitem(sys.modules, "open_clip", fake_open_clip(calls))
    torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "torch", torch)

    openai = ClipEncoder("ViT-B-32", "openai")
    ClipEncoder("ViT-B-32", "laion2b_s34b_b79k")

    assert [c["quick_gelu"] for c in calls] == [True, False]
    # The name stays the same: reports, gate thresholds and the pocket index all refer to it.
    assert openai.name == "ViT-B-32/openai"
