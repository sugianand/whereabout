"""Image embeddings that survive between Atlas runs.

Encoding a photo is the expensive half of a guess: every catalog photo goes through every
compared CLIP model on a CPU runner, while turning an embedding into a guess (country
probabilities, then cities) is a few matrix products. So each embedding is stored once per
(model, photo, image bytes) and later runs only encode photos they have not seen, which keeps
the Atlas workflow's cost proportional to the photos a harvest adds rather than to the whole
catalog.

The key includes a hash of the image file, so a photo whose image changed is encoded again,
and EMBEDDING_VERSION, to be bumped if preprocessing changes. Files are `.npy`, so a reused
embedding is bit-for-bit the one the model produced and reused guesses equal fresh ones.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

# 2: photos are turned upright by their EXIF tag, and OpenAI's weights run with QuickGELU.
EMBEDDING_VERSION = 2


class ImageEncoder(Protocol):
    name: str

    def encode_images(self, paths: Sequence[Path]) -> np.ndarray: ...


@dataclass(frozen=True)
class CacheStats:
    reused: int
    encoded: int


def safe_name(model: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in model)


def image_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def embedding_cache_path(cache: Path, model: str, photo_id: str, digest: str) -> Path:
    return cache / safe_name(model) / f"{photo_id}-{digest}-v{EMBEDDING_VERSION}.npy"


def _load(file: Path) -> np.ndarray | None:
    """A cached embedding, or None if it is missing or unreadable (then it is re-encoded)."""
    if not file.exists():
        return None
    try:
        vec = np.load(file, allow_pickle=False)
    except (OSError, ValueError):
        return None
    return vec if vec.ndim == 1 and vec.size > 0 and np.all(np.isfinite(vec)) else None


def cached_image_embeddings(
    encoder: ImageEncoder,
    photo_ids: Sequence[str],
    paths: Sequence[Path],
    cache: Path,
) -> tuple[np.ndarray, CacheStats]:
    """Embeddings for `paths` (one row per photo, input order), encoding only cache misses.

    Misses are encoded in one `encode_images` call, so batching works as before, and written
    to the cache. A cached vector whose size differs from the fresh ones (a damaged file) is
    encoded again and overwritten.
    """
    if len(photo_ids) != len(paths):
        raise ValueError("photo_ids and paths must have the same length")
    if not paths:
        return np.zeros((0, 0), dtype=np.float32), CacheStats(reused=0, encoded=0)
    files = [
        embedding_cache_path(cache, encoder.name, pid, image_digest(path))
        for pid, path in zip(photo_ids, paths, strict=True)
    ]
    vectors: list[np.ndarray | None] = [_load(f) for f in files]
    reused = sum(v is not None for v in vectors)
    missing = [i for i, v in enumerate(vectors) if v is None]
    while missing:
        fresh = np.asarray(encoder.encode_images([paths[i] for i in missing]))
        if fresh.ndim != 2 or fresh.shape[0] != len(missing):
            raise ValueError(f"encoder returned shape {fresh.shape} for {len(missing)} images")
        for i, vec in zip(missing, fresh, strict=True):
            vectors[i] = vec
            files[i].parent.mkdir(parents=True, exist_ok=True)
            np.save(files[i], vec, allow_pickle=False)
        dim = fresh.shape[1]
        stale = [i for i, v in enumerate(vectors) if v is not None and v.shape != (dim,)]
        reused -= len(stale)
        missing = stale
    shapes = {v.shape for v in vectors if v is not None}
    if len(shapes) > 1:
        raise ValueError(f"cached embeddings disagree in size {sorted(shapes)}; clear {cache}")
    return np.stack(vectors), CacheStats(reused=reused, encoded=len(paths) - reused)
