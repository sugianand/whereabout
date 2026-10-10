"""CLIP image/text encoder via open_clip (install with `pip install -e "ml[clip]"`)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np


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
            model_name, pretrained=pretrained, device=self.device
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
        from PIL import Image

        out = []
        with self._torch.no_grad():
            for i in range(0, len(paths), self.batch_size):
                batch = [
                    self.preprocess(Image.open(p).convert("RGB"))
                    for p in paths[i : i + self.batch_size]
                ]
                feats = self.model.encode_image(self._torch.stack(batch).to(self.device))
                out.append(self._normalise(feats))
        return np.concatenate(out)

    def _normalise(self, feats) -> np.ndarray:
        feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.float().cpu().numpy()
