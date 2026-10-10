"""Geographic-block train/validation split.

A random split leaks: two photos of the same street, beach or skyline land on both sides, and
a model that memorised the training photo looks like it "located" the validation one. Here the
world is cut into latitude/longitude blocks and every block goes wholly to one side, so the
nearest training photo to any validation photo is at least a block boundary away.

Assignment hashes the block id with a seed instead of drawing random numbers, so a block keeps
its side when photos are added or removed: the validation set only ever grows by new places.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass

from whereabout_api.geo import LatLon, haversine_km
from whereabout_api.photos import Photo

Block = tuple[int, int]


@dataclass(frozen=True, slots=True)
class Split:
    train: tuple[Photo, ...]
    val: tuple[Photo, ...]
    block_deg: float

    @property
    def val_fraction(self) -> float:
        total = len(self.train) + len(self.val)
        return len(self.val) / total if total else 0.0


def block_of(point: LatLon, block_deg: float) -> Block:
    """The (row, column) of the block containing `point`.

    Blocks are `block_deg` degrees on a side. The east edge (lon 180) and north pole (lat 90)
    fold into the last column and row so every valid coordinate has exactly one block.
    """
    if not (math.isfinite(block_deg) and 0 < block_deg <= 90):
        raise ValueError("block_deg must be in (0, 90]")
    rows = math.ceil(180 / block_deg)
    cols = math.ceil(360 / block_deg)
    row = min(int((point.lat + 90) // block_deg), rows - 1)
    col = min(int((point.lon + 180) // block_deg), cols - 1)
    return row, col


def _goes_to_val(block: Block, val_fraction: float, seed: int) -> bool:
    digest = hashlib.sha256(f"{seed}:{block[0]}:{block[1]}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64 < val_fraction


def geographic_split(
    photos: Sequence[Photo], *, val_fraction: float = 0.2, block_deg: float = 1.0, seed: int = 0
) -> Split:
    """Split photos so that no block contributes to both train and validation.

    `val_fraction` is the share of *blocks* sent to validation, so the share of photos only
    approaches it when photos are spread over many blocks. Report `Split.val_fraction`, not the
    requested one.
    """
    if not 0.0 <= val_fraction <= 1.0:
        raise ValueError("val_fraction must be in [0, 1]")
    train: list[Photo] = []
    val: list[Photo] = []
    for photo in photos:
        block = block_of(photo.location, block_deg)
        (val if _goes_to_val(block, val_fraction, seed) else train).append(photo)
    return Split(tuple(train), tuple(val), block_deg)


def leaked_blocks(split: Split) -> set[Block]:
    """Blocks that appear on both sides. Always empty for a split made by geographic_split."""
    train_blocks = {block_of(p.location, split.block_deg) for p in split.train}
    val_blocks = {block_of(p.location, split.block_deg) for p in split.val}
    return train_blocks & val_blocks


def min_cross_distance_km(split: Split) -> float | None:
    """Distance from the closest validation photo to its nearest training photo.

    A small number means near-duplicates may straddle a block edge; raise `block_deg` if it
    matters. None when either side is empty. Quadratic, meant for audits, not training loops.
    """
    if not split.train or not split.val:
        return None
    return min(haversine_km(v.location, t.location) for v in split.val for t in split.train)
