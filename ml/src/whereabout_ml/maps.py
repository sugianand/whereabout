"""Climate-zone and land-cover labels, looked up from open raster maps by coordinates.

Atlas v1's clue heads learn concepts such as "temperate oceanic climate" or "cropland" from
labels that nobody typed: each training photo's latitude and longitude is looked up in a map
(docs/architecture.md, "Clue heads"). Every concept map answers the same question,

    ConceptMap.labels(points) -> one label (or None) per point

so the training code does not care whether a label came from a country table
(`labels.DrivingSideMap`) or a raster. Two rasters are wired up here, both CC BY 4.0 (sources,
attribution and file layout in data/maps/README.md):

- Köppen-Geiger climate classification at 1 km (Beck et al., Scientific Data): codes 1-30.
- ESA WorldCover land cover at 10 m, as 3°×3° tiles: codes 10-100.

A raster is read with `RasterSource.sample(points, window)`. With `window` > 1 the label is the
most common class in a window×window block around the point rather than the single pixel: a
photo is taken from a road or a viewpoint, and the 10 m pixel under the photographer's feet is
often not what the photo shows. Pixels without data never vote; a block with no data is None.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from whereabout_api.geo import LatLon


class ConceptMap(Protocol):
    """A concept that can be labelled from coordinates alone."""

    name: str

    def labels(self, points: Sequence[LatLon]) -> list[str | None]: ...


class RasterSource(Protocol):
    """Integer class codes on a latitude/longitude (EPSG:4326) grid."""

    nodata: int

    def sample(self, points: Sequence[LatLon], window: int = 1) -> np.ndarray: ...


def _check_window(window: int) -> int:
    if window < 1 or window % 2 == 0:
        raise ValueError("window must be a positive odd number of pixels")
    return window // 2


def block_mode(block: np.ndarray, nodata: int) -> int:
    """Most common class in `block`, ignoring nodata.

    Ties go to the centre pixel if it is among the winners, else to the smallest code, so the
    answer never depends on iteration order.
    """
    flat = block.ravel()
    valid = flat[flat != nodata]
    if valid.size == 0:
        return nodata
    codes, counts = np.unique(valid, return_counts=True)
    winners = codes[counts == counts.max()]
    centre = block[block.shape[0] // 2, block.shape[1] // 2]
    return int(centre) if centre in winners else int(winners.min())


@dataclass(frozen=True)
class GridRaster:
    """An in-memory north-up grid: pixel (row, col) covers
    lat ∈ (north − (row+1)·res_lat, north − row·res_lat], lon ∈ [west + col·res_lon, …).

    A grid spanning the full 360° of longitude wraps around the antimeridian, so a window at
    lon 179.9° sees pixels at −179.9°. Points outside the grid read as nodata.
    """

    values: np.ndarray
    west: float
    north: float
    res_lon: float
    res_lat: float
    nodata: int = 0

    def __post_init__(self) -> None:
        if self.values.ndim != 2:
            raise ValueError("values must be a 2-D grid")
        if self.res_lon <= 0 or self.res_lat <= 0:
            raise ValueError("resolutions must be positive")

    @property
    def wraps(self) -> bool:
        return math.isclose(self.values.shape[1] * self.res_lon, 360.0, rel_tol=1e-9)

    def pixel(self, p: LatLon) -> tuple[int, int] | None:
        rows, cols = self.values.shape
        row = math.floor((self.north - p.lat) / self.res_lat)
        col = math.floor((p.lon - self.west) / self.res_lon)
        if row == rows and math.isclose(p.lat, self.north - rows * self.res_lat):
            row = rows - 1  # the southern edge belongs to the last row
        if self.wraps:
            col %= cols
        elif col == cols and math.isclose(p.lon, self.west + cols * self.res_lon):
            col = cols - 1  # likewise the eastern edge
        if not (0 <= row < rows and 0 <= col < cols):
            return None
        return row, col

    def sample(self, points: Sequence[LatLon], window: int = 1) -> np.ndarray:
        half = _check_window(window)
        rows, cols = self.values.shape
        out = np.full(len(points), self.nodata, dtype=np.int64)
        offsets = np.arange(-half, half + 1)
        for i, p in enumerate(points):
            rc = self.pixel(p)
            if rc is None:
                continue
            r = rc[0] + offsets
            c = rc[1] + offsets
            block = np.full((window, window), self.nodata, dtype=self.values.dtype)
            r_ok = (r >= 0) & (r < rows)
            if self.wraps:
                c, c_ok = c % cols, np.ones(window, bool)
            else:
                c_ok = (c >= 0) & (c < cols)
            block[np.ix_(r_ok, c_ok)] = self.values[np.ix_(r[r_ok], c[c_ok])]
            out[i] = block_mode(block, self.nodata)
        return out


class GeoTiffRaster:
    """One GeoTIFF in EPSG:4326, read a small window per point (the file is never loaded whole:
    the 1 km Köppen map alone is ~900 MB as a grid). Needs `pip install -e "ml[maps]"`."""

    def __init__(self, path: Path | str, *, nodata: int | None = None) -> None:
        import rasterio  # optional dependency, imported only when a real map is used

        self._ds = rasterio.open(path)
        crs = self._ds.crs
        if crs is None or crs.to_epsg() != 4326:
            raise ValueError(f"{path}: expected a latitude/longitude (EPSG:4326) raster, got {crs}")
        file_nodata = self._ds.nodata
        self.nodata = int(nodata if nodata is not None else (file_nodata or 0))

    def close(self) -> None:
        self._ds.close()

    def __enter__(self) -> GeoTiffRaster:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def sample(self, points: Sequence[LatLon], window: int = 1) -> np.ndarray:
        from rasterio.windows import Window

        half = _check_window(window)
        ds = self._ds
        out = np.full(len(points), self.nodata, dtype=np.int64)
        for i, p in enumerate(points):
            row, col = ds.index(p.lon, p.lat)
            if p.lat == ds.bounds.bottom:
                row -= 1
            if p.lon == ds.bounds.right:
                col -= 1
            if not (0 <= row < ds.height and 0 <= col < ds.width):
                continue
            block = ds.read(
                1,
                window=Window(col - half, row - half, window, window),
                boundless=True,
                fill_value=self.nodata,
            )
            out[i] = block_mode(block, self.nodata)
        return out


def worldcover_tile(lat: float, lon: float, *, year: int = 2021, version: str = "v200") -> str:
    """File name of the ESA WorldCover 3°×3° tile containing (lat, lon).

    Tiles are named by their south-west corner, e.g. N51E000 covers 51–54°N, 0–3°E.
    """
    south = math.floor(lat / 3) * 3
    west = math.floor(lon / 3) * 3
    south = min(south, 81)  # 90°N is the top edge of the last row of tiles
    west = min(west, 177)  # 180°E is the right edge of the last column
    ns = f"{'N' if south >= 0 else 'S'}{abs(south):02d}"
    ew = f"{'E' if west >= 0 else 'W'}{abs(west):03d}"
    return f"ESA_WorldCover_10m_{year}_{version}_{ns}{ew}_Map.tif"


class TiledRaster:
    """A map split into GeoTIFF tiles in one directory. Points whose tile is absent (open sea,
    or simply not downloaded) read as nodata. Windows do not cross tile edges; at an edge the
    missing side is treated as nodata and does not vote."""

    def __init__(
        self, directory: Path | str, tile_name: Callable[[float, float], str], nodata: int = 0
    ) -> None:
        self.directory = Path(directory)
        self.tile_name = tile_name
        self.nodata = nodata

    def sample(self, points: Sequence[LatLon], window: int = 1) -> np.ndarray:
        _check_window(window)
        out = np.full(len(points), self.nodata, dtype=np.int64)
        by_tile: dict[str, list[int]] = defaultdict(list)
        for i, p in enumerate(points):
            by_tile[self.tile_name(p.lat, p.lon)].append(i)
        for name, idx in by_tile.items():
            path = self.directory / name
            if not path.exists():
                continue
            with GeoTiffRaster(path, nodata=self.nodata) as tile:
                out[idx] = tile.sample([points[i] for i in idx], window)
        return out


@dataclass(frozen=True)
class CategoricalMap:
    """A raster of class codes plus the legend that names them."""

    name: str
    source: RasterSource
    legend: Mapping[int, str]
    window: int = 1

    def codes(self, points: Sequence[LatLon]) -> np.ndarray:
        return self.source.sample(points, self.window)

    def labels(self, points: Sequence[LatLon]) -> list[str | None]:
        return [self.legend.get(int(c)) for c in self.codes(points)]


# Köppen-Geiger legend of Beck et al. (2018, 2023), codes 1-30; 0 is sea / no data.
# fmt: off
_KOPPEN_CLASSES = (
    "Af", "Am", "Aw", "BWh", "BWk", "BSh", "BSk", "Csa", "Csb", "Csc", "Cwa", "Cwb", "Cwc", "Cfa",
    "Cfb", "Cfc", "Dsa", "Dsb", "Dsc", "Dsd", "Dwa", "Dwb", "Dwc", "Dwd", "Dfa", "Dfb", "Dfc",
    "Dfd", "ET", "EF",
)
# fmt: on
KOPPEN_GEIGER: dict[int, str] = dict(enumerate(_KOPPEN_CLASSES, start=1))

KOPPEN_GROUPS: dict[str, str] = {
    "A": "Tropical",
    "B": "Arid",
    "C": "Temperate",
    "D": "Continental",
    "E": "Polar",
}

_KOPPEN_CODE = re.compile(r"^(A[fmw]|B[WS][hk]|C[swf][abc]|D[swf][abcd]|E[TF])$")


def koppen_group(climate: str | None) -> str | None:
    """Main Köppen group of a full class: "Cfb" → "Temperate". None passes through."""
    if climate is None:
        return None
    if not _KOPPEN_CODE.match(climate):
        raise ValueError(f"not a Köppen-Geiger class: {climate!r}")
    return KOPPEN_GROUPS[climate[0]]


# ESA WorldCover 2020/2021 legend; 0 is no data.
WORLDCOVER: dict[int, str] = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen",
}


def koppen_geiger_map(path: Path | str, *, window: int = 1) -> CategoricalMap:
    """Climate from the 1 km Köppen-Geiger GeoTIFF (one pixel ≈ 1 km is already coarse)."""
    return CategoricalMap("climate", GeoTiffRaster(path, nodata=0), KOPPEN_GEIGER, window)


def worldcover_map(directory: Path | str, *, window: int = 15) -> CategoricalMap:
    """Land cover from WorldCover tiles; by default the majority class within ~150 m."""
    return CategoricalMap(
        "land_cover", TiledRaster(directory, worldcover_tile, nodata=0), WORLDCOVER, window
    )


def label_points(
    points: Sequence[LatLon], maps: Sequence[ConceptMap]
) -> list[dict[str, str | None]]:
    """One row per point with every concept's label, e.g. {"climate": "Cfb", ...}."""
    names = [m.name for m in maps]
    if len(set(names)) != len(names):
        raise ValueError(f"concept names must be unique: {names}")
    columns = {m.name: m.labels(points) for m in maps}
    return [{name: columns[name][i] for name in names} for i in range(len(points))]
