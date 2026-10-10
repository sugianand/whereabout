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


def test_the_guesses_carry_the_results_of_the_run_that_made_them():
    atlas, report, _ = build_outputs(PHOTOS, systems(), now="2026-10-10T00:00:00+00:00")
    evaluation = atlas["evaluation"]
    assert evaluation["n"] == 2
    assert [s["name"] for s in evaluation["systems"]] == ["wrong", "right", "baseline"]
    assert [s["name"] for s in evaluation["systems"] if s["playsInGame"]] == ["right"]
    right = next(s for s in evaluation["systems"] if s["name"] == "right")
    assert right["median_km"] == report["systems"]["right"]["median_km"] == 0


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

    # Pixels: one channel per word, lit everywhere the word "appears", so hiding cells dims it.
    def load_pixels(self, path):
        on = self._embed(path.read_text()) > 0.5
        return np.repeat(on.astype(np.float32)[:, None, None], 14, axis=1).repeat(14, axis=2), (
            0.0,
            0.0,
            1.0,
            1.0,
        )

    def encode_pixels(self, batch):
        v = 1e-3 + batch.mean(axis=(2, 3))
        return v / np.linalg.norm(v, axis=1, keepdims=True)


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
            "--saliency-cache",
            str(tmp_path / "saliency"),
        ]
    )

    atlas = json.loads(atlas_out.read_text())
    assert atlas["model"] == "Fake-1/test, country then city"
    assert atlas["guesses"]["kyoto"]["guessedPlace"] == "Kyoto, JP"
    looked = atlas["guesses"]["kyoto"]["looked"]
    # The fake lights every pixel alike, so no cell matters more than another: shape and range
    # are what this checks (test_saliency.py checks that maps find what a model uses).
    assert looked["grid"] == 7 and len(looked["cells"]) == 49
    assert all(0.0 <= v <= 1.0 for v in looked["cells"])
    assert atlas["evaluation"]["saliency"]["n"] == 2
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


def test_download_skips_a_photo_that_keeps_failing(tmp_path, monkeypatch):
    calls = []

    def fake_fetch(url, **_):
        calls.append(url)
        if "cusco" in url:
            raise RuntimeError("gave up: HTTP 403")
        return b"jpeg bytes"

    monkeypatch.setattr(run_atlas_v0, "fetch", fake_fetch)
    kept, paths, failed = run_atlas_v0.download_images(PHOTOS, tmp_path, pause_s=0)
    assert [p.id for p in kept] == ["kyoto"]
    assert paths == [tmp_path / "kyoto.jpg"] and paths[0].read_bytes() == b"jpeg bytes"
    assert failed == {"cusco": "gave up: HTTP 403"}

    # Cached photos are never fetched again.
    calls.clear()
    run_atlas_v0.download_images(PHOTOS[:1], tmp_path, pause_s=0)
    assert calls == []


def test_fetch_retries_throttling_then_succeeds(monkeypatch):
    import io
    import urllib.error

    attempts = []

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(req, timeout):
        attempts.append(req.full_url)
        if len(attempts) < 3:
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)
        return Response(b"ok")

    monkeypatch.setattr(run_atlas_v0.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(run_atlas_v0.time, "sleep", lambda s: None)
    assert run_atlas_v0.fetch("https://x/a.jpg") == b"ok"
    assert len(attempts) == 3


def test_fetch_does_not_retry_a_missing_file(monkeypatch):
    import urllib.error

    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(run_atlas_v0.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(urllib.error.HTTPError):
        run_atlas_v0.fetch("https://x/missing.jpg")


def test_skipped_photos_are_reported():
    _, report, markdown = build_outputs(
        PHOTOS, systems(), now="2026-10-10T00:00:00+00:00", skipped={"wm9": "HTTP 403"}
    )
    assert report["skipped"] == {"wm9": "HTTP 403"}
    assert "1 photos couldn't be downloaded: wm9." in markdown
