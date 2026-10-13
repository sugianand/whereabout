"""Geographic-block train/validation split, with a leakage check.

A random split of geotagged photos is optimistic for a geolocation model: two shots of the same
street corner land on both sides, and the model scores by recognising the *place* rather than
learning to generalise. So we split by geography. The globe is cut into a fixed grid of blocks
(bands of `block_deg` degrees of latitude, each cut into columns whose longitude width widens by
1/cos(lat), so blocks are roughly equal area instead of slivers near the poles), and whole blocks
go to train or validation by a seeded hash of the block key. Hashing the key, not the photo,
means a block is never divided, the result does not depend on row order, and adding photos later
never moves an existing photo to the other side.

Blocks alone still leak at their borders: a photo on one side of a block edge has near-duplicates
a few kilometres away on the other. `buffer_km` therefore drops (labels "buffer") every train
photo within that great-circle distance of any validation photo. `check_leakage` verifies the
result independently: no block shared between the splits, and the closest cross-split pair is at
least `min_km` apart.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_ml.geocells import haversine_matrix

TRAIN, VAL, BUFFER = "train", "val", "buffer"
DEFAULT_CATALOG = Path("data/curation/photos.csv")
DEFAULT_OUT = Path("data/splits/geo_block_split.csv")
_CHUNK = 1024  # rows of the distance matrix computed at once, to bound memory


class LeakageError(ValueError):
    """Train and validation are not independent enough."""


@dataclass(frozen=True, slots=True)
class SplitResult:
    ids: tuple[str, ...]
    labels: tuple[str, ...]  # "train" | "val" | "buffer", aligned with ids
    blocks: tuple[str, ...]  # block key of each photo, aligned with ids

    def counts(self) -> dict[str, int]:
        return {s: self.labels.count(s) for s in (TRAIN, VAL, BUFFER)}


@dataclass(frozen=True, slots=True)
class LeakageReport:
    closest_km: float  # inf when either side is empty
    closest_pair: tuple[int, int] | None  # (index into train, index into val)
    shared_blocks: tuple[str, ...]
    min_km: float

    @property
    def ok(self) -> bool:
        return not self.shared_blocks and self.closest_km >= self.min_km


def block_key(lat: float, lon: float, block_deg: float) -> str:
    """The grid block containing a point, as "band:column".

    Bands are `block_deg` of latitude. A band's column count is how many slices of at least
    `block_deg / cos(centre latitude)` degrees of longitude fit in 360, so polar bands have few,
    wide blocks (a band may be a single block all the way round the pole).
    """
    if block_deg <= 0:
        raise ValueError("block_deg must be positive")
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"latitude out of range: {lat}")
    bands = max(1, math.ceil(180.0 / block_deg))
    band = min(bands - 1, int((lat + 90.0) // block_deg))
    south = -90.0 + band * block_deg
    centre = (south + min(90.0, south + block_deg)) / 2
    columns = max(1, math.floor(360.0 * math.cos(math.radians(centre)) / block_deg))
    wrapped = (lon + 180.0) % 360.0  # 180 and -180 are the same meridian
    return f"{band}:{min(columns - 1, int(wrapped / 360.0 * columns))}"


def _is_val(key: str, seed: int, val_frac: float) -> bool:
    digest = hashlib.sha256(f"{seed}:{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64 < val_frac


def _coords(points: Sequence[LatLon]) -> tuple[np.ndarray, np.ndarray]:
    return np.array([p.lat for p in points]), np.array([p.lon for p in points])


def _min_distance(a: Sequence[LatLon], b: Sequence[LatLon]) -> tuple[float, tuple[int, int] | None]:
    """Smallest great-circle distance between any point of A and any of B (km), and the pair."""
    if not a or not b:
        return math.inf, None
    a_lat, a_lon = _coords(a)
    b_lat, b_lon = _coords(b)
    best, pair = math.inf, None
    for i in range(0, len(a), _CHUNK):
        d = haversine_matrix(a_lat[i : i + _CHUNK], a_lon[i : i + _CHUNK], b_lat, b_lon)
        r, c = np.unravel_index(int(np.argmin(d)), d.shape)
        if d[r, c] < best:
            best, pair = float(d[r, c]), (i + int(r), int(c))
    return best, pair


def geo_split(
    ids: Sequence[str],
    points: Sequence[LatLon],
    *,
    block_deg: float = 10.0,
    val_frac: float = 0.2,
    seed: int = 0,
    buffer_km: float = 50.0,
) -> SplitResult:
    if len(ids) != len(points):
        raise ValueError("ids and points differ in length")
    if not 0.0 <= val_frac <= 1.0:
        raise ValueError("val_frac must be in [0, 1]")
    if buffer_km < 0:
        raise ValueError("buffer_km must be non-negative")
    blocks = [block_key(p.lat, p.lon, block_deg) for p in points]
    labels = [VAL if _is_val(k, seed, val_frac) else TRAIN for k in blocks]

    val_idx = [i for i, s in enumerate(labels) if s == VAL]
    train_idx = [i for i, s in enumerate(labels) if s == TRAIN]
    if buffer_km > 0 and val_idx and train_idx:
        v_lat, v_lon = _coords([points[i] for i in val_idx])
        for start in range(0, len(train_idx), _CHUNK):
            chunk = train_idx[start : start + _CHUNK]
            c_lat, c_lon = _coords([points[i] for i in chunk])
            near = (haversine_matrix(c_lat, c_lon, v_lat, v_lon) < buffer_km).any(axis=1)
            for i, is_near in zip(chunk, near, strict=True):
                if is_near:
                    labels[i] = BUFFER
    return SplitResult(tuple(ids), tuple(labels), tuple(blocks))


def check_leakage(
    train: Sequence[LatLon],
    val: Sequence[LatLon],
    min_km: float,
    *,
    block_deg: float | None = None,
    raise_on_leak: bool = True,
) -> LeakageReport:
    """Closest train-to-val distance, plus (if `block_deg` is given) any block on both sides.

    Raises `LeakageError` when the closest pair is nearer than `min_km` or a block is shared,
    unless `raise_on_leak=False`, in which case the report's `ok` says so.
    """
    closest, pair = _min_distance(train, val)
    shared: tuple[str, ...] = ()
    if block_deg is not None:
        t = {block_key(p.lat, p.lon, block_deg) for p in train}
        v = {block_key(p.lat, p.lon, block_deg) for p in val}
        shared = tuple(sorted(t & v))
    report = LeakageReport(closest, pair, shared, min_km)
    if raise_on_leak and not report.ok:
        raise LeakageError(
            f"closest train/val pair is {closest:.1f} km apart (need >= {min_km:g} km); "
            f"shared blocks: {list(shared) or 'none'}"
        )
    return report


def check_split(
    result: SplitResult, points: Sequence[LatLon], block_deg: float, min_km: float
) -> LeakageReport:
    """`check_leakage` applied to a `SplitResult` (buffer photos belong to neither side)."""
    train = [p for p, s in zip(points, result.labels, strict=True) if s == TRAIN]
    val = [p for p, s in zip(points, result.labels, strict=True) if s == VAL]
    return check_leakage(train, val, min_km, block_deg=block_deg)


def read_catalog(path: Path) -> tuple[list[str], list[LatLon]]:
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [r["id"] for r in rows], [LatLon(float(r["lat"]), float(r["lon"])) for r in rows]


def write_split(path: Path, result: SplitResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["id", "split"])
        w.writerows(sorted(zip(result.ids, result.labels, strict=True)))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--block-deg", type=float, default=10.0)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--buffer-km", type=float, default=50.0)
    args = ap.parse_args(argv)

    ids, points = read_catalog(args.catalog)
    result = geo_split(
        ids,
        points,
        block_deg=args.block_deg,
        val_frac=args.val_frac,
        seed=args.seed,
        buffer_km=args.buffer_km,
    )
    report = check_split(result, points, args.block_deg, args.buffer_km)
    write_split(args.out, result)
    counts = result.counts()
    print(f"{len(ids)} photos: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"closest train/val pair: {report.closest_km:.1f} km (required >= {args.buffer_km:g})")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
