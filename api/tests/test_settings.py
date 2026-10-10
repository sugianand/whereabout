from pathlib import Path

from whereabout_api.settings import DEFAULT_ATLAS, DEFAULT_CATALOG, Settings


def test_defaults():
    s = Settings.from_env({})
    assert s.catalog_path == DEFAULT_CATALOG
    assert DEFAULT_CATALOG.exists()
    assert s.atlas_path == DEFAULT_ATLAS
    assert s.cors_origins == ("http://localhost:3000",)


def test_reads_environment():
    s = Settings.from_env(
        {
            "WHEREABOUT_CATALOG": "/srv/photos.csv",
            "WHEREABOUT_ATLAS": "/srv/atlas.json",
            "WHEREABOUT_CORS_ORIGINS": "https://a.example, https://b.example ,",
        }
    )
    assert s.catalog_path == Path("/srv/photos.csv")
    assert s.atlas_path == Path("/srv/atlas.json")
    assert s.cors_origins == ("https://a.example", "https://b.example")
