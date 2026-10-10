"""The atlas-v0 runner end to end, with a fake encoder: no network, no model weights."""

import argparse
import json
import math

import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_ml import run_atlas_v0
from whereabout_ml.run_atlas_v0 import (
    System,
    build_outputs,
    guess_to_json,
    parse_model,
    pick_best,
    predictions_from_guesses,
)
from whereabout_ml.zeroshot import Guess

PHOTOS = [
    Photo("kyoto", LatLon(35.01, 135.77), "Kyoto", country="JP", image_url="https://x/kyoto.jpg"),
    Photo("cusco", LatLon(-13.53, -71.97), "Cusco", country="PE", image_url="https://x/cusco.jpg"),
]
RIGHT = [
    Guess(35.01, 135.77, "Kyoto", "JP", 0.9, (("JP", 0.9),), ()),
    Guess(-13.53, -71.97, "Cusco", "PE", 0.8, (("PE", 0.8),), ()),
]
WRONG = [
    Guess(-13.53, -71.97, "Cusco", "PE", 0.6, (("PE", 0.6),), ()),
    Guess(35.01, 135.77, "Kyoto", "JP", 0.6, (("JP", 0.6),), ()),
]


def systems():
    return [
        System("wrong", predictions_from_guesses(PHOTOS, WRONG), WRONG),
        System("right", predictions_from_guesses(PHOTOS, RIGHT), RIGHT),
        System("baseline", predictions_from_guesses(PHOTOS, WRONG)),
    ]


def test_guess_json_matches_the_web_contract():
    assert set(guess_to_json(RIGHT[0])) == {
        "lng",
        "lat",
        "confidence",
        "guessedPlace",
        "topCountries",
        "clues",
    }
    assert guess_to_json(RIGHT[0])["lng"] == 135.77


def test_the_most_accurate_playable_system_plays_in_the_game():
    atlas, report, markdown = build_outputs(PHOTOS, systems(), now="2026-10-10T00:00:00+00:00")
    assert atlas["model"] == "right"
    assert atlas["guesses"]["cusco"]["guessedPlace"] == "Cusco, PE"
    assert report["playing_in_game"] == "right"
    assert report["systems"]["right"]["median_km"] == 0
    assert {c["versus"] for c in report["best_vs_others"]} == {"wrong", "baseline"}
    assert "| right | 2 |" in markdown
    assert "Possible leakage" in markdown


def test_baselines_are_scored_but_never_play():
    only_baseline = [System("baseline", predictions_from_guesses(PHOTOS, RIGHT))]
    for s in only_baseline:
        s.report = None
    with pytest.raises(ValueError):
        pick_best(only_baseline)


def test_model_specs_need_a_pretrained_tag():
    assert parse_model("ViT-L-14:openai") == ("ViT-L-14", "openai")
    with pytest.raises(argparse.ArgumentTypeError):
        parse_model("ViT-L-14")


class FakeClip:
    """Stands in for ClipEncoder: images and texts embed by the place words they mention."""

    WORDS = ["Japan", "Kyoto", "Osaka", "Peru", "Cusco", "Lima"]

    def __init__(self, model_name, pretrained):
        self.name = f"{model_name}/{pretrained}"

    def _embed(self, text):
        v = np.full(len(self.WORDS), 1e-3)
        for i, w in enumerate(self.WORDS):
            if w in text:
                v[i] = 1.0
        return v / np.linalg.norm(v)

    def encode_texts(self, texts):
        return np.stack([self._embed(t) for t in texts])

    def encode_images(self, paths):
        return np.stack([self._embed(p.read_text()) for p in paths])


def test_main_runs_the_whole_pipeline_offline(tmp_path, monkeypatch):
    catalog = tmp_path / "photos.csv"
    catalog.write_text(
        "id,image_url,lat,lon,place,country,author,license,source_url\n"
        "kyoto,https://x/kyoto.jpg,35.01,135.77,Kyoto,JP,A,CC0,https://x/k\n"
        "cusco,https://x/cusco.jpg,-13.53,-71.97,Cusco,PE,B,CC0,https://x/c\n"
    )
    geo = tmp_path / "geonames"
    geo.mkdir()
    (geo / "countryInfo.txt").write_text(
        "#ISO\tISO3\tnum\tfips\tCountry\n"
        "JP\tJPN\t392\tJA\tJapan\tTokyo\n"
        "PE\tPER\t604\tPE\tPeru\tLima\n"
    )
    rows = [
        ("Osaka", 34.69, 135.50, "JP", 2700000),
        ("Kyoto", 35.01, 135.77, "JP", 1400000),
        ("Lima", -12.05, -77.04, "PE", 8000000),
        ("Cusco", -13.53, -71.97, "PE", 430000),
    ]
    lines = []
    for i, (name, lat, lon, cc, pop) in enumerate(rows):
        cols = [str(i), name, name, "", str(lat), str(lon), "P", "PPL", cc] + [""] * 5 + [str(pop)]
        lines.append("\t".join(cols))
    (geo / "cities15000.txt").write_text("\n".join(lines) + "\n")

    # Pre-filled image cache: the fake encoder reads each "image" as text.
    images = tmp_path / "images"
    images.mkdir()
    (images / "kyoto.jpg").write_text("Japan Kyoto")
    (images / "cusco.jpg").write_text("Peru Cusco")

    monkeypatch.setattr("whereabout_ml.clip_encoder.ClipEncoder", FakeClip)
    atlas_out = tmp_path / "atlas.json"
    results = tmp_path / "results"
    run_atlas_v0.main(
        [
            "--catalog",
            str(catalog),
            "--gazetteer",
            str(geo),
            "--images",
            str(images),
            "--atlas-out",
            str(atlas_out),
            "--results-dir",
            str(results),
            "--model",
            "Fake-1:test",
        ]
    )

    atlas = json.loads(atlas_out.read_text())
    assert atlas["model"] == "Fake-1/test, country then city"
    assert atlas["guesses"]["kyoto"]["guessedPlace"] == "Kyoto, JP"
    report = json.loads((results / "atlas-v0.json").read_text())
    assert set(report["systems"]) == {
        "Random city (baseline)",
        "Best constant guess (baseline)",
        "Fake-1/test, country only",
        "Fake-1/test, country then city",
    }
    full = report["systems"]["Fake-1/test, country then city"]
    assert full["median_km"] == 0 and full["country_accuracy"] == 1.0
    # The ablation guesses Osaka and Lima, so it is measurably worse than the full pipeline.
    assert report["systems"]["Fake-1/test, country only"]["median_km"] > 0
    assert (results / "atlas-v0.md").read_text().startswith("# Atlas v0 results")
    assert not math.isnan(report["systems"]["Random city (baseline)"]["mean_km"])
