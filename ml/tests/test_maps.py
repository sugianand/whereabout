import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_ml.gazetteer import City
from whereabout_ml.labels import DrivingSideMap, NearestPlaceLocator
from whereabout_ml.maps import (
    KOPPEN_GEIGER,
    WORLDCOVER,
    CategoricalMap,
    GeoTiffRaster,
    GridRaster,
    TiledRaster,
    block_mode,
    koppen_geiger_map,
    koppen_group,
    label_points,
    worldcover_map,
    worldcover_tile,
)

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

RNG = np.random.default_rng(3)

# Real places and their real Köppen-Geiger classes, painted into a 1° fixture map below.
KNOWN_CLIMATES = {
    "London": (LatLon(51.507, -0.128), "Cfb"),
    "Cairo": (LatLon(30.044, 31.236), "BWh"),
    "Singapore": (LatLon(1.352, 103.820), "Af"),
    "Moscow": (LatLon(55.756, 37.617), "Dfb"),
    "McMurdo Station": (LatLon(-77.846, 166.676), "EF"),
    "Lisbon": (LatLon(38.722, -9.139), "Csa"),
}
CODE = {name: code for code, name in KOPPEN_GEIGER.items()}


def koppen_fixture() -> GridRaster:
    """A global 1° grid that is sea (0) except the cells holding the known places."""
    grid = GridRaster(np.zeros((180, 360), np.uint8), west=-180, north=90, res_lon=1, res_lat=1)
    for point, climate in KNOWN_CLIMATES.values():
        r, c = grid.pixel(point)
        grid.values[r, c] = CODE[climate]
    return grid


def write_geotiff(path, grid: GridRaster, crs="EPSG:4326"):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=grid.values.shape[0],
        width=grid.values.shape[1],
        count=1,
        dtype=grid.values.dtype,
        crs=crs,
        transform=from_origin(grid.west, grid.north, grid.res_lon, grid.res_lat),
        nodata=grid.nodata,
    ) as ds:
        ds.write(grid.values, 1)
    return path


# --- legends -----------------------------------------------------------------------------------


def test_koppen_legend_matches_beck_et_al():
    assert len(KOPPEN_GEIGER) == 30
    assert (KOPPEN_GEIGER[1], KOPPEN_GEIGER[4], KOPPEN_GEIGER[15]) == ("Af", "BWh", "Cfb")
    assert (KOPPEN_GEIGER[26], KOPPEN_GEIGER[29], KOPPEN_GEIGER[30]) == ("Dfb", "ET", "EF")
    assert {koppen_group(c) for c in KOPPEN_GEIGER.values()} == {
        "Tropical",
        "Arid",
        "Temperate",
        "Continental",
        "Polar",
    }


def test_koppen_group():
    assert koppen_group("Cfb") == "Temperate"
    assert koppen_group("BWh") == "Arid"
    assert koppen_group(None) is None
    with pytest.raises(ValueError):
        koppen_group("Xyz")


def test_worldcover_legend():
    assert sorted(WORLDCOVER) == [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
    assert WORLDCOVER[50] == "Built-up"


# --- pixel arithmetic --------------------------------------------------------------------------


def test_known_places_land_in_their_own_cells():
    grid = koppen_fixture()
    climate = CategoricalMap("climate", grid, KOPPEN_GEIGER)
    names = list(KNOWN_CLIMATES)
    labels = climate.labels([KNOWN_CLIMATES[n][0] for n in names])
    assert labels == [KNOWN_CLIMATES[n][1] for n in names]
    # Mid-Atlantic and mid-Pacific are sea: no label rather than a guess.
    assert climate.labels([LatLon(30, -40), LatLon(-20, -140)]) == [None, None]


@pytest.mark.parametrize(
    ("lat", "lon", "rc"),
    [
        (90.0, -180.0, (0, 0)),
        (89.5, -179.5, (0, 0)),
        (-90.0, 179.999, (179, 359)),  # southern edge belongs to the last row
        (0.0, 0.0, (90, 180)),  # cell boundaries belong to the cell south-east of them
        (0.0, 180.0, (90, 0)),  # +180° is −180° on a grid that wraps
        (-0.5, -0.5, (90, 179)),
    ],
)
def test_pixel_edges(lat, lon, rc):
    assert koppen_fixture().pixel(LatLon(lat, lon)) == rc


def test_points_outside_a_regional_grid_are_nodata():
    grid = GridRaster(np.full((10, 10), 7, np.uint8), west=0, north=10, res_lon=1, res_lat=1)
    assert grid.wraps is False
    out = grid.sample([LatLon(5, 5), LatLon(5, 10), LatLon(5, 10.5), LatLon(-1, 5)])
    assert out.tolist() == [7, 7, 0, 0]


def test_block_mode_ignores_nodata_and_breaks_ties_predictably():
    assert block_mode(np.array([[0, 0, 0], [0, 5, 0], [0, 0, 0]]), 0) == 5
    assert block_mode(np.zeros((3, 3), int), 0) == 0
    assert block_mode(np.array([[3, 3, 0], [9, 9, 0], [0, 0, 0]]), 0) == 9  # centre wins a tie
    assert block_mode(np.array([[3, 3, 0], [0, 0, 0], [9, 9, 0]]), 0) == 3  # else smallest


def test_window_takes_the_majority_around_the_point():
    values = np.full((9, 9), 40, np.uint8)  # cropland ...
    values[4, 4] = 50  # ... with a road under the photographer
    grid = GridRaster(values, west=0, north=9, res_lon=1, res_lat=1)
    p = [LatLon(4.5, 4.5)]
    assert grid.sample(p, window=1).tolist() == [50]
    assert grid.sample(p, window=3).tolist() == [40]
    with pytest.raises(ValueError):
        grid.sample(p, window=2)


def test_window_wraps_across_the_antimeridian():
    values = np.zeros((4, 360), np.uint8)
    values[:, 0] = 30  # a strip just east of −180°
    values[:, 1] = 30
    grid = GridRaster(values, west=-180, north=2, res_lon=1, res_lat=1)
    # At 179.5°E the 5-wide window reaches two columns past the antimeridian.
    assert grid.sample([LatLon(0.5, 179.5)], window=5).tolist() == [30]


# --- GeoTIFF -----------------------------------------------------------------------------------


def test_geotiff_agrees_with_the_in_memory_grid(tmp_path):
    grid = GridRaster(
        RNG.integers(0, 4, (60, 120)).astype(np.uint8), west=10, north=50, res_lon=0.5, res_lat=0.5
    )
    path = write_geotiff(tmp_path / "map.tif", grid)
    points = [LatLon(float(a), float(b)) for a, b in RNG.uniform([20, 10], [50, 70], (200, 2))]
    points += [LatLon(20.0, 70.0), LatLon(50.0, 10.0), LatLon(60.0, 30.0)]  # edges and outside
    with GeoTiffRaster(path) as tif:
        for window in (1, 3, 5):
            assert tif.sample(points, window).tolist() == grid.sample(points, window).tolist()


def test_koppen_geiger_map_reads_known_places_from_a_geotiff(tmp_path):
    path = write_geotiff(tmp_path / "koppen_geiger_0p01.tif", koppen_fixture())
    climate = koppen_geiger_map(path)
    labels = climate.labels([p for p, _ in KNOWN_CLIMATES.values()])
    assert labels == [c for _, c in KNOWN_CLIMATES.values()]
    assert [koppen_group(c) for c in labels] == [
        "Temperate",
        "Arid",
        "Tropical",
        "Continental",
        "Polar",
        "Temperate",
    ]


def test_geotiff_must_be_lat_lon(tmp_path):
    path = write_geotiff(tmp_path / "utm.tif", koppen_fixture(), crs="EPSG:32631")
    with pytest.raises(ValueError, match="EPSG:4326"):
        GeoTiffRaster(path)


# --- WorldCover tiles --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lat", "lon", "tile"),
    [
        (51.5, -0.1, "N51W003"),
        (51.5, 0.1, "N51E000"),
        (-33.9, 151.2, "S36E150"),
        (0.0, 0.0, "N00E000"),
        (-0.1, -0.1, "S03W003"),
        (90.0, 180.0, "N81E177"),
        (-90.0, -180.0, "S90W180"),
    ],
)
def test_worldcover_tile_names(lat, lon, tile):
    assert worldcover_tile(lat, lon) == f"ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"


def test_worldcover_map_reads_the_right_tile_and_skips_missing_ones(tmp_path):
    # Two 3° tiles at 0.01°: London's (N51W003) is built-up in its east half, cropland
    # elsewhere; the tile east of it (N51E000) is all tree cover. Nothing else is downloaded.
    london = np.full((300, 300), 40, np.uint8)
    london[:, 150:] = 50
    write_geotiff(
        tmp_path / worldcover_tile(51.5, -0.1), GridRaster(london, -3, 54, 0.01, 0.01, nodata=0)
    )
    write_geotiff(
        tmp_path / worldcover_tile(51.5, 0.1),
        GridRaster(np.full((300, 300), 10, np.uint8), 0, 54, 0.01, 0.01, nodata=0),
    )
    land = worldcover_map(tmp_path, window=3)
    points = [
        LatLon(51.507, -0.128),  # east half of the London tile
        LatLon(51.507, -2.5),  # west half
        LatLon(51.507, 0.5),  # next tile east
        LatLon(48.857, 2.352),  # Paris: tile not downloaded
    ]
    assert land.labels(points) == ["Built-up", "Cropland", "Tree cover", None]


def test_tiled_raster_with_no_tiles_is_all_nodata(tmp_path):
    tiles = TiledRaster(tmp_path, worldcover_tile)
    assert tiles.sample([LatLon(0, 0), LatLon(10, 10)]).tolist() == [0, 0]


# --- one interface for every concept -----------------------------------------------------------


def test_label_points_combines_country_and_raster_concepts():
    places = [City("London", "GB", 51.507, -0.128, 9_000_000), City("Cairo", "EG", 30.04, 31.24, 1)]
    maps = [
        CategoricalMap("climate", koppen_fixture(), KOPPEN_GEIGER),
        DrivingSideMap(NearestPlaceLocator(places)),
    ]
    rows = label_points(
        [KNOWN_CLIMATES["London"][0], KNOWN_CLIMATES["Cairo"][0], LatLon(30, -40)], maps
    )
    assert rows == [
        {"climate": "Cfb", "driving_side": "left"},
        {"climate": "BWh", "driving_side": "right"},
        {"climate": None, "driving_side": None},
    ]
    with pytest.raises(ValueError, match="unique"):
        label_points([], [maps[0], maps[0]])
