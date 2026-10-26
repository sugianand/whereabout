import csv
import io
import json
import urllib.error
import zipfile
from pathlib import Path

import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_ml import concept_labels as cl
from whereabout_ml.maps import KOPPEN_GEIGER, WORLDCOVER, CategoricalMap, GridRaster

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

CODE = {name: code for code, name in KOPPEN_GEIGER.items()}
LAND = {name: code for code, name in WORLDCOVER.items()}
REPO = Path(__file__).resolve().parents[2]

LEGEND_TXT = "Koppen-Geiger classification legend\n" + "".join(
    f"  {code:>2}:  {name:<4} Some description   [0 0 255]\n"
    for code, name in KOPPEN_GEIGER.items()
)


def write_tif(path: Path, values: np.ndarray, west: float, north: float, res: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=values.shape[0],
        width=values.shape[1],
        count=1,
        dtype=values.dtype,
        crs="EPSG:4326",
        transform=from_origin(west, north, res, res),
        nodata=0,
    ) as ds:
        ds.write(values, 1)
    return path


def koppen_grid(cells: dict[tuple[float, float], str]) -> np.ndarray:
    """A global 1° climate grid, sea except the cells holding the given points."""
    grid = GridRaster(np.zeros((180, 360), np.uint8), west=-180, north=90, res_lon=1, res_lat=1)
    for (lat, lon), climate in cells.items():
        r, c = grid.pixel(LatLon(lat, lon))
        grid.values[r, c] = CODE[climate]
    return grid.values


def worldcover_tile_file(directory: Path, lat: float, lon: float, cover: str) -> Path:
    """A whole 3°×3° tile of one land-cover class, at a coarse 0.01° for speed."""
    name = cl.worldcover_tile(lat, lon)
    south, west = np.floor(lat / 3) * 3, np.floor(lon / 3) * 3
    values = np.full((300, 300), LAND[cover], np.uint8)
    return write_tif(directory / name, values, west, south + 3, 0.01)


def photo(pid: str, lat: float, lon: float, country: str) -> Photo:
    return Photo(
        id=pid,
        location=LatLon(lat, lon),
        place_name=pid,
        image_url=f"https://example.org/{pid}.jpg",
        attribution="someone",
        license="CC0",
        country=country,
        source_url=f"https://example.org/{pid}",
    )


# --- fetching --------------------------------------------------------------------------------


def test_needed_tiles_are_unique_and_sorted():
    points = [LatLon(51.5, 0.1), LatLon(52.0, 1.0), LatLon(-33.9, 151.2)]
    assert cl.needed_tiles(points) == [
        "ESA_WorldCover_10m_2021_v200_N51E000_Map.tif",
        "ESA_WorldCover_10m_2021_v200_S36E150_Map.tif",
    ]


def test_download_copies_a_file_and_reports_a_missing_one(tmp_path):
    src = tmp_path / "src.bin"
    src.write_bytes(b"x" * 3_000_000)
    dest = tmp_path / "out" / "copy.bin"
    assert cl.download(src.as_uri(), dest)
    assert dest.read_bytes() == src.read_bytes()
    assert not cl.download((tmp_path / "nope.bin").as_uri(), tmp_path / "nope.bin")
    assert not list(tmp_path.rglob("*.part"))


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def test_download_retries_server_errors_then_gives_up_on_404(tmp_path, monkeypatch):
    calls = []

    def urlopen(req, timeout):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, None)
        if req.full_url.endswith("missing"):
            raise urllib.error.HTTPError(req.full_url, 404, "not found", {}, None)
        assert "WhereaboutBot" in req.get_header("User-agent")
        return FakeResponse(b"tile")

    monkeypatch.setattr(cl.urllib.request, "urlopen", urlopen)
    assert cl.download("https://x/tile", tmp_path / "tile", backoff_s=0)
    assert (tmp_path / "tile").read_bytes() == b"tile"
    assert len(calls) == 2
    assert not cl.download("https://x/missing", tmp_path / "missing", backoff_s=0)


def test_download_raises_after_repeated_failures(tmp_path, monkeypatch):
    def urlopen(req, timeout):
        raise urllib.error.URLError(ConnectionResetError("reset"))

    monkeypatch.setattr(cl.urllib.request, "urlopen", urlopen)
    with pytest.raises(RuntimeError, match="gave up"):
        cl.download("https://x/tile", tmp_path / "tile", attempts=2, backoff_s=0)
    assert not (tmp_path / "tile").exists()


def test_fetch_worldcover_skips_present_tiles_and_lists_absent_ones(tmp_path):
    remote = tmp_path / "remote"
    worldcover_tile_file(remote, 51.5, 0.1, "Built-up")
    local = tmp_path / "local"
    land, sea = cl.worldcover_tile(51.5, 0.1), cl.worldcover_tile(0.0, -150.0)  # open Pacific
    available, absent = cl.fetch_worldcover([land, sea], local, remote.as_uri())
    assert (available, absent) == ([land], [sea])
    (remote / land).unlink()  # already local: must not be fetched again
    assert cl.fetch_worldcover([land, sea], local, remote.as_uri())[0] == [land]


def test_pick_file_and_member_are_strict():
    article = {"files": [{"name": "koppen_geiger_tif.zip"}, {"name": "koppen_geiger_nc.zip"}]}
    assert cl.pick_file(article, cl.KOPPEN_ARCHIVE)["name"] == "koppen_geiger_tif.zip"
    with pytest.raises(LookupError, match="koppen_geiger_nc.zip"):
        cl.pick_file({"files": article["files"][1:]}, cl.KOPPEN_ARCHIVE)
    members = [
        "1991_2020/koppen_geiger_0p1.tif",
        "2071_2099/ssp245/koppen_geiger_0p00833333.tif",
        "1991_2020/koppen_geiger_0p00833333.tif",
    ]
    assert cl.pick_member(members, cl.KOPPEN_MEMBER) == members[2]
    with pytest.raises(LookupError):
        cl.pick_member(members[:2], cl.KOPPEN_MEMBER)


def make_koppen_archive(tmp_path: Path, grid: np.ndarray, legend: str = LEGEND_TXT) -> str:
    """A figshare article JSON (file:// URL) whose archive holds decoys and the real map."""
    tif = write_tif(tmp_path / "k.tif", grid, -180, 90, 1)
    archive = tmp_path / "remote" / "koppen_geiger_tif.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("legend.txt", legend)
        zf.writestr("1991_2020/koppen_geiger_0p1.tif", b"decoy")
        zf.writestr("2071_2099/ssp585/koppen_geiger_0p00833333.tif", b"decoy")
        zf.write(tif, "1991_2020/koppen_geiger_0p00833333.tif")
    article = tmp_path / "remote" / "article.json"
    files = [
        {"id": 1, "name": "koppen_geiger_nc.zip", "download_url": "file:///nowhere"},
        {"id": 2, "name": "koppen_geiger_tif.zip", "download_url": archive.as_uri()},
    ]
    article.write_text(json.dumps({"files": files}))
    return article.as_uri()


def test_fetch_koppen_extracts_only_the_present_day_map_and_legend(tmp_path):
    grid = koppen_grid({(51.5, -0.1): "Cfb"})
    url = make_koppen_archive(tmp_path, grid)
    out = tmp_path / "maps"
    out.mkdir()
    info = cl.fetch_koppen(out, url)
    assert info == {
        "archive": "koppen_geiger_tif.zip",
        "figshare_file_id": "2",
        "map_member": "1991_2020/koppen_geiger_0p00833333.tif",
        "legend_member": "legend.txt",
    }
    assert sorted(p.name for p in out.iterdir()) == [cl.KOPPEN_FILE, cl.KOPPEN_LEGEND]
    with rasterio.open(out / cl.KOPPEN_FILE) as ds:
        assert np.array_equal(ds.read(1), grid)


# --- checks ----------------------------------------------------------------------------------


def test_legend_round_trips_and_mismatches_are_named():
    legend = cl.parse_koppen_legend(LEGEND_TXT + "   0:  Ocean\n")
    assert legend[1] == "Af" and legend[30] == "EF"
    assert cl.legend_mismatches(legend) == []
    swapped = dict(legend)
    swapped[14], swapped[15] = "Cfb", "Cfa"
    assert cl.legend_mismatches(swapped) == [
        "code 14: maps.py says Cfa, the legend says Cfb",
        "code 15: maps.py says Cfb, the legend says Cfa",
    ]
    assert "code 30" in cl.legend_mismatches({k: v for k, v in legend.items() if k != 30})[0]
    with pytest.raises(ValueError):
        cl.parse_koppen_legend("nothing here")


def grid_map(name: str, cells: dict[tuple[float, float], int], legend) -> CategoricalMap:
    grid = GridRaster(np.zeros((180, 360), np.uint8), west=-180, north=90, res_lon=1, res_lat=1)
    for (lat, lon), code in cells.items():
        r, c = grid.pixel(LatLon(lat, lon))
        grid.values[r, c] = code
    return CategoricalMap(name, grid, legend)


def test_check_known_places_reads_each_concept_from_its_map():
    places = [
        cl.KnownPlace("London", LatLon(51.5, -0.1), "climate", frozenset({"Cfb"})),
        cl.KnownPlace("Cairo", LatLon(30.0, 31.2), "climate", frozenset({"BWh"})),
        cl.KnownPlace("Manhattan", LatLon(40.75, -73.98), "land_cover", frozenset({"Built-up"})),
    ]
    maps = {
        "climate": grid_map("climate", {(51.5, -0.1): CODE["Cfb"]}, KOPPEN_GEIGER),
        "land_cover": grid_map("land_cover", {(40.75, -73.98): LAND["Built-up"]}, WORLDCOVER),
    }
    checks = {c.place.name: c for c in cl.check_known_places(places, maps)}
    assert checks["London"].ok and checks["Manhattan"].ok
    assert not checks["Cairo"].ok and checks["Cairo"].got is None
    table = cl.checks_markdown(list(checks.values()))
    assert "| Cairo | climate | None | BWh | **FAIL** |" in table
    with pytest.raises(KeyError):
        cl.check_known_places(places, {"climate": maps["climate"]})


def test_the_committed_known_places_are_well_formed():
    places = cl.load_known_places(REPO / "data" / "fixtures" / "concept_places.json")
    assert {p.concept for p in places} == {"climate", "land_cover"}
    for p in places:
        legend = KOPPEN_GEIGER if p.concept == "climate" else WORLDCOVER
        assert p.accept <= set(legend.values()), p.name


# --- labelling and the command line ----------------------------------------------------------


def test_label_catalog_leaves_unknowns_empty():
    photos = [photo("lon", 51.5, -0.1, "GB"), photo("sea", 0.0, -150.0, "KI")]
    rows = cl.label_catalog(
        photos,
        grid_map("climate", {(51.5, -0.1): CODE["Cfb"]}, KOPPEN_GEIGER),
        grid_map("land_cover", {(51.5, -0.1): LAND["Built-up"]}, WORLDCOVER),
    )
    assert rows == [
        {
            "id": "lon",
            "climate": "Cfb",
            "climate_group": "Temperate",
            "land_cover": "Built-up",
            "driving_side": "left",
        },
        {"id": "sea", "climate": "", "climate_group": "", "land_cover": "", "driving_side": "left"},
    ]
    assert cl.coverage(rows)["climate"] == {"Cfb": 1, "unlabelled": 1}


CATALOG_HEADER = "id,image_url,lat,lon,place,country,author,license,source_url\n"


def write_world(tmp_path: Path, *, london_climate: str = "Cfb") -> tuple[list[str], Path]:
    """Remote maps for two photos (Paris, open Pacific) and two known places."""
    remote = tmp_path / "remote"
    worldcover_tile_file(remote, 48.85, 2.35, "Built-up")
    worldcover_tile_file(remote, 51.5, -0.1, "Built-up")
    grid = koppen_grid({(48.85, 2.35): "Cfb", (51.5, -0.1): london_climate})
    article = make_koppen_archive(tmp_path, grid)
    catalog = tmp_path / "photos.csv"
    catalog.write_text(
        CATALOG_HEADER
        + "paris,https://e.org/p.jpg,48.85,2.35,Paris,FR,A,CC0,https://e.org/p\n"
        + "ocean,https://e.org/o.jpg,0.0,-150.0,Pacific,KI,B,CC0,https://e.org/o\n"
    )
    known = tmp_path / "known.json"
    known.write_text(
        json.dumps(
            {
                "places": [
                    {
                        "name": "London",
                        "lat": 51.5,
                        "lon": -0.1,
                        "concept": "climate",
                        "accept": ["Cfb"],
                    },
                    {
                        "name": "London",
                        "lat": 51.5,
                        "lon": -0.1,
                        "concept": "land_cover",
                        "accept": ["Built-up"],
                    },
                ]
            }
        )
    )
    argv = [
        "--catalog", str(catalog),
        "--maps-dir", str(tmp_path / "maps"),
        "--known-places", str(known),
        "--out", str(tmp_path / "labels" / "concept_labels.csv"),
        "--koppen-article-url", article,
        "--worldcover-url", remote.as_uri(),
    ]  # fmt: skip
    return argv, tmp_path / "labels" / "concept_labels.csv"


def test_main_downloads_checks_and_labels(tmp_path, capsys):
    argv, out = write_world(tmp_path)
    assert cl.main([*argv, "--download"]) == 0
    with out.open() as fh:
        rows = list(csv.DictReader(fh))
    assert rows == [
        {"id": "paris", "climate": "Cfb", "climate_group": "Temperate", "land_cover": "Built-up",
         "driving_side": "right"},
        {"id": "ocean", "climate": "", "climate_group": "", "land_cover": "",
         "driving_side": "left"},
    ]  # fmt: skip
    meta = json.loads(out.with_suffix(".meta.json").read_text())
    assert meta["photos"] == 2
    assert meta["known_places_checked"] == 2
    assert meta["worldcover_tiles_needed"] == 3
    assert meta["worldcover_tiles_absent"] == ["ESA_WorldCover_10m_2021_v200_N00W150_Map.tif"]
    assert meta["koppen"]["figshare_file_id"] == "2"
    assert "| London | climate | Cfb | Cfb | ok |" in capsys.readouterr().out

    # A second run without --download reuses the maps on disk.
    out.unlink()
    assert cl.main(argv) == 0
    assert out.exists()


def test_main_refuses_to_label_when_a_known_place_reads_wrong(tmp_path, capsys):
    argv, out = write_world(tmp_path, london_climate="Dfb")
    assert cl.main([*argv, "--download"]) == 1
    assert not out.exists()
    assert "London" in capsys.readouterr().err


def test_main_refuses_a_legend_that_disagrees_with_maps_py(tmp_path, capsys):
    argv, out = write_world(tmp_path)
    assert cl.main([*argv, "--download"]) == 0
    legend = Path(argv[argv.index("--maps-dir") + 1]) / cl.KOPPEN_LEGEND
    legend.write_text(LEGEND_TXT.replace(" 14:  Cfa", " 14:  Cfb"))
    assert cl.main(argv) == 1
    assert "code 14" in capsys.readouterr().err


def test_main_without_maps_asks_for_download(tmp_path, capsys):
    argv, _ = write_world(tmp_path)
    assert cl.main(argv) == 2
    assert "--download" in capsys.readouterr().err


REFERENCES_HEADER = "id,title,lat,lon,country,place,author,license,source_url,thumb_url\n"


def test_label_references_reads_climate_and_driving_side():
    from whereabout_ml.retrieval import Reference

    refs = [
        Reference("wr1", 51.5, -0.1, "GB", "London", "A", "https://c/1"),
        Reference("wr2", 0.0, -150.0, "FR", "Sea", "B", "https://c/2"),
        Reference("wr3", 10.0, 10.0, "AQ", "Nowhere", "C", "https://c/3"),
    ]
    rows = cl.label_references(
        refs, grid_map("climate", {(51.5, -0.1): CODE["Cfb"]}, KOPPEN_GEIGER)
    )
    assert rows == [
        {"id": "wr1", "climate": "Cfb", "climate_group": "Temperate", "driving_side": "left"},
        {"id": "wr2", "climate": "", "climate_group": "", "driving_side": "right"},
        {"id": "wr3", "climate": "", "climate_group": "", "driving_side": ""},
    ]


def test_main_labels_the_reference_photos_too(tmp_path, capsys):
    argv, _ = write_world(tmp_path)
    refs = tmp_path / "references.csv"
    refs.write_text(
        REFERENCES_HEADER
        + "wr1,File:a.jpg,48.85,2.35,FR,Paris,A,CC0,https://c/1,https://t/1.jpg\n"
        + "wr2,File:b.jpg,0.0,-150.0,KI,Sea,B,CC0,https://c/2,https://t/2.jpg\n"
    )
    out = tmp_path / "reference" / "concept_labels.csv"
    assert (
        cl.main([*argv, "--download", "--references", str(refs), "--references-out", str(out)]) == 0
    )
    with out.open() as fh:
        assert list(csv.DictReader(fh)) == [
            {"id": "wr1", "climate": "Cfb", "climate_group": "Temperate", "driving_side": "right"},
            {"id": "wr2", "climate": "", "climate_group": "", "driving_side": "left"},
        ]
    meta = json.loads(out.with_suffix(".meta.json").read_text())
    assert meta["references"] == 2
    assert meta["coverage"]["climate_group"] == {"Temperate": 1, "unlabelled": 1}
    assert "labelled 2 reference photos" in capsys.readouterr().out


def test_references_and_their_output_go_together(tmp_path):
    argv, _ = write_world(tmp_path)
    with pytest.raises(SystemExit):
        cl.main([*argv, "--references", str(tmp_path / "r.csv")])
