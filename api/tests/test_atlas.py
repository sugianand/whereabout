import json

import pytest

from whereabout_api.atlas import AtlasFileError, load_atlas, parse_guess
from whereabout_api.catalog import load_catalog
from whereabout_api.settings import DEFAULT_ATLAS, DEFAULT_CATALOG

GOOD = {
    "lng": 135.77,
    "lat": 35.01,
    "confidence": 0.62,
    "guessedPlace": "Kyoto, JP",
    "topCountries": [{"country": "JP", "p": 0.62}, {"country": "KR", "p": 0.2}],
    "clues": [{"label": "Temple", "p": 0.9}],
}


def test_parses_a_guess():
    g = parse_guess("p1", GOOD)
    assert (g.location.lat, g.location.lon) == (35.01, 135.77)
    assert g.guessed_place == "Kyoto, JP"
    assert g.top_countries == (("JP", 0.62), ("KR", 0.2))
    assert g.clues[0].label == "Temple"


@pytest.mark.parametrize(
    "patch",
    [{"lat": 95}, {"lng": "east"}, {"confidence": 1.5}, {"clues": [{"label": "x", "p": -0.1}]}],
)
def test_rejects_bad_guesses_naming_the_photo(patch):
    with pytest.raises(AtlasFileError, match="p1"):
        parse_guess("p1", {**GOOD, **patch})


def test_missing_file_means_no_guesses(tmp_path):
    assert load_atlas(tmp_path / "atlas.json") == {}


def test_malformed_file_fails_loudly(tmp_path):
    path = tmp_path / "atlas.json"
    path.write_text("{not json")
    with pytest.raises(AtlasFileError):
        load_atlas(path)
    path.write_text(json.dumps({"guesses": []}))
    with pytest.raises(AtlasFileError):
        load_atlas(path)


def test_the_committed_guesses_load_and_cover_only_catalog_photos():
    guesses = load_atlas(DEFAULT_ATLAS)
    catalog_ids = {p.id for p in load_catalog(DEFAULT_CATALOG)}
    assert set(guesses) <= catalog_ids
