"""CLIP image/text encoder via open_clip (install with `pip install -e "ml[clip]"`)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np


def load_rgb(path: Path):
    """A photo as RGB, turned upright by its EXIF orientation tag.

    Browsers (and so the game and Pocket Atlas) show a photo the way its EXIF tag says; PIL
    does not unless asked. Without this, a phone photo stored sideways was embedded sideways.
    """
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        return ImageOps.exif_transpose(im).convert("RGB")


def needs_quick_gelu(pretrained: str) -> bool:
    """OpenAI's CLIP weights were trained with QuickGELU; open_clip's plain configs use GELU.

    open_clip only warns about the mismatch, and the model then runs with the wrong activation
    (transformers.js, which Pocket Atlas uses, gets it right, which is how the gap showed up).
    """
    return pretrained == "openai"


class ClipEncoder:
    def __init__(
        self,
        model_name: str = "ViT-L-14",
        pretrained: str = "openai",
        device: str | None = None,
        batch_size: int = 64,
    ) -> None:
        import open_clip
        import torch

        self._torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained=pretrained,
            device=self.device,
            force_quick_gelu=needs_quick_gelu(pretrained),
        )
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer(model_name)
        self.batch_size = batch_size
        self.name = f"{model_name}/{pretrained}"

    def encode_texts(self, texts: Sequence[str]) -> np.ndarray:
        out = []
        with self._torch.no_grad():
            for i in range(0, len(texts), self.batch_size):
                tokens = self.tokenizer(list(texts[i : i + self.batch_size])).to(self.device)
                feats = self.model.encode_text(tokens)
                out.append(self._normalise(feats))
        return np.concatenate(out)

    def encode_images(self, paths: Sequence[Path]) -> np.ndarray:
        out = []
        with self._torch.no_grad():
            for i in range(0, len(paths), self.batch_size):
                batch = [self.preprocess(load_rgb(p)) for p in paths[i : i + self.batch_size]]
                feats = self.model.encode_image(self._torch.stack(batch).to(self.device))
                out.append(self._normalise(feats))
        return np.concatenate(out)

    def load_pixels(self, path: Path) -> tuple[np.ndarray, tuple[float, float, float, float]]:
        """The (C, H, W) input CLIP sees for `path`, and where that square sits in the photo.

        The crop box assumes open_clip's evaluation transform (resize the short side, then
        centre-crop), which is checked here rather than trusted.
        """
        from whereabout_ml.saliency import centre_crop_box

        steps = [type(t).__name__ for t in getattr(self.preprocess, "transforms", [])]
        if "CenterCrop" not in steps:
            raise RuntimeError(f"unexpected CLIP preprocessing {steps}: crop box unknown")
        rgb = load_rgb(path)
        return self.preprocess(rgb).numpy(), centre_crop_box(*rgb.size)

    def encode_pixels(self, batch: np.ndarray) -> np.ndarray:
        """Embed already-preprocessed (N, C, H, W) pixels, e.g. occluded copies of a photo."""
        out = []
        with self._torch.no_grad():
            for i in range(0, len(batch), self.batch_size):
                chunk = self._torch.from_numpy(np.ascontiguousarray(batch[i : i + self.batch_size]))
                out.append(self._normalise(self.model.encode_image(chunk.to(self.device))))
        return np.concatenate(out)

    def _normalise(self, feats) -> np.ndarray:
        feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.float().cpu().numpy()
