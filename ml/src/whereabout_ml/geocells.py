"""Geocells: the classes a trained Atlas predicts.

Regressing latitude and longitude averages a photo that could be Lisbon or Rio into the middle
of the Atlantic. Classifying over regions keeps both hypotheses alive, so Atlas v1 predicts a
*cell*. Cells come from an adaptive quadtree over latitude/longitude (in the spirit of PlaNet's
S2 cells): a cell splits while it holds more than `max_points` training photos, so Paris gets
many small cells and the Sahara a few big ones. Leaves with fewer than `min_points` photos are
dropped as classes (too few to learn from); their photos join the nearest kept cell.

A cell's guess point is the spherical mean of its photos, not its geometric centre: a cell
covering a coastline should guess the city on it, not the sea next to it.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from whereabout_api.geo import EARTH_RADIUS_KM, LatLon


@dataclass(frozen=True, slots=True)
class Cell:
    key: str  # quadtree path, e.g. "21" = second child's first child; "" is the whole world
    south: float
    west: float
    north: float
    east: float
    centroid: LatLon
    count: int


def to_xyz(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def spherical_mean(lat: np.ndarray, lon: np.ndarray) -> LatLon:
    """The point on the sphere nearest the 3D mean of the inputs (correct across ±180°)."""
    v = to_xyz(np.asarray(lat, float), np.asarray(lon, float)).mean(axis=0)
    n = np.linalg.norm(v)
    if n < 1e-12:  # antipodal points cancel out; any of them is as good as the mean
        return LatLon(float(lat[0]), float(lon[0]))
    v /= n
    return LatLon(
        float(np.degrees(math.asin(max(-1.0, min(1.0, v[2]))))),
        float(np.degrees(math.atan2(v[1], v[0]))),
    )


def haversine_matrix(a_lat, a_lon, b_lat, b_lon) -> np.ndarray:
    """Great-circle distances (km) between every point in A and every point in B, vectorised."""
    p1, p2 = (
        np.radians(np.asarray(a_lat, float))[:, None],
        np.radians(np.asarray(b_lat, float))[None, :],
    )
    dl = (
        np.radians(np.asarray(b_lon, float))[None, :]
        - np.radians(np.asarray(a_lon, float))[:, None]
    )
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(h, 0.0, 1.0)))


class Geocells:
    def __init__(self, cells: Sequence[Cell], max_depth: int) -> None:
        if not cells:
            raise ValueError("no cells")
        self.cells = tuple(cells)
        self.max_depth = max_depth
        self._index = {c.key: i for i, c in enumerate(self.cells)}
        self._lat = np.array([c.centroid.lat for c in self.cells])
        self._lon = np.array([c.centroid.lon for c in self.cells])

    def __len__(self) -> int:
        return len(self.cells)

    @property
    def centroids(self) -> tuple[np.ndarray, np.ndarray]:
        return self._lat, self._lon

    @classmethod
    def build(
        cls,
        points: Sequence[LatLon],
        *,
        max_points: int = 200,
        min_points: int = 20,
        max_depth: int = 12,
    ) -> Geocells:
        if not points:
            raise ValueError("no training points")
        lat = np.array([p.lat for p in points])
        lon = np.array([p.lon for p in points])
        cells: list[Cell] = []

        def visit(key: str, s: float, w: float, n: float, e: float, idx: np.ndarray) -> None:
            if len(idx) > max_points and len(key) < max_depth:
                mlat, mlon = (s + n) / 2, (w + e) / 2
                # Children in reading order: 0 north-west, 1 north-east, 2 south-west, 3 south-east.
                for child, (cs, cw, cn, ce) in enumerate(
                    [(mlat, w, n, mlon), (mlat, mlon, n, e), (s, w, mlat, mlon), (s, mlon, mlat, e)]
                ):
                    inside = idx[
                        (lat[idx] >= cs)
                        & ((lat[idx] < cn) | (cn == 90.0))
                        & (lon[idx] >= cw)
                        & ((lon[idx] < ce) | (ce == 180.0))
                    ]
                    visit(key + str(child), cs, cw, cn, ce, inside)
            elif len(idx) >= min_points:
                cells.append(Cell(key, s, w, n, e, spherical_mean(lat[idx], lon[idx]), len(idx)))

        visit("", -90.0, -180.0, 90.0, 180.0, np.arange(len(points)))
        if not cells:
            raise ValueError(f"no cell reached min_points={min_points}; lower it or add data")
        return cls(cells, max_depth)

    def leaf_key(self, p: LatLon) -> str:
        """The quadtree path of the deepest-possible cell containing `p`."""
        s, w, n, e = -90.0, -180.0, 90.0, 180.0
        key = ""
        while key not in self._index and len(key) < self.max_depth:
            mlat, mlon = (s + n) / 2, (w + e) / 2
            north, east = p.lat >= mlat, p.lon >= mlon
            key += str((0 if north else 2) + (1 if east else 0))
            s, n = (mlat, n) if north else (s, mlat)
            w, e = (mlon, e) if east else (w, mlon)
        return key

    def assign(self, points: Sequence[LatLon]) -> np.ndarray:
        """Class index for each point: its own cell, or the nearest kept cell if its was dropped."""
        out = np.empty(len(points), dtype=np.int64)
        for i, p in enumerate(points):
            key = self.leaf_key(p)
            # A point can only be inside a kept cell if some prefix of its path is a cell.
            hit = next(
                (self._index[key[:k]] for k in range(len(key), -1, -1) if key[:k] in self._index),
                None,
            )
            if hit is not None and self._contains(self.cells[hit], p):
                out[i] = hit
            else:
                d = haversine_matrix([p.lat], [p.lon], self._lat, self._lon)[0]
                out[i] = int(np.argmin(d))
        return out

    @staticmethod
    def _contains(c: Cell, p: LatLon) -> bool:
        return (c.south <= p.lat < c.north or (c.north == 90.0 and p.lat == 90.0)) and (
            c.west <= p.lon < c.east or (c.east == 180.0 and p.lon == 180.0)
        )

    def to_json(self) -> dict:
        return {
            "maxDepth": self.max_depth,
            "cells": [
                {
                    "key": c.key,
                    "bounds": [c.south, c.west, c.north, c.east],
                    "centroid": [round(c.centroid.lat, 5), round(c.centroid.lon, 5)],
                    "count": c.count,
                }
                for c in self.cells
            ],
        }

    @classmethod
    def from_json(cls, data: dict) -> Geocells:
        cells = [
            Cell(c["key"], *c["bounds"], LatLon(*c["centroid"]), c["count"]) for c in data["cells"]
        ]
        return cls(cells, data["maxDepth"])


def soft_targets(cells: Geocells, points: Sequence[LatLon], tau_km: float = 75.0) -> np.ndarray:
    """Distance-aware labels: a cell near the truth is 'less wrong' than one far away.

        q_i ∝ exp(−(d(c_i, y) − d(c_true, y)) / τ)

    with d the great-circle distance from cell centroid c_i to the photo's location y. The true
    cell gets the most weight; neighbours share some, so the loss stops punishing a guess in the
    next town as harshly as one on another continent.
    """
    if tau_km <= 0:
        raise ValueError("tau_km must be positive")
    clat, clon = cells.centroids
    d = haversine_matrix([p.lat for p in points], [p.lon for p in points], clat, clon)
    true = cells.assign(points)
    rel = d - d[np.arange(len(points)), true][:, None]
    logits = -rel / tau_km
    logits -= logits.max(axis=1, keepdims=True)
    q = np.exp(logits)
    return q / q.sum(axis=1, keepdims=True)
