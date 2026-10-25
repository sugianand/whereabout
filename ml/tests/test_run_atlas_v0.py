"""The atlas-v0 runner end to end, with a fake encoder: no network, no model weights."""

import argparse
import json
import math
import re

import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_ml import run_atlas_v0
from whereabout_ml.run_atlas_v0 import (
    System,
    belief_from_probabilities,
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


def test_belief_keeps_countries_at_or_above_half_a_percent_rounded_largest_first():
    belief = belief_from_probabilities(["ES", "FR", "IT", "DE"], [0.12049, 0.41249, 0.005, 0.00499])
    assert belief == {"FR": 0.412, "ES": 0.12, "IT": 0.005}
    assert list(belief) == ["FR", "ES", "IT"]


def test_belief_is_only_written_when_given():
    assert "belief" not in guess_to_json(RIGHT[0])
    assert guess_to_json(RIGHT[0], belief={"JP": 0.9})["belief"] == {"JP": 0.9}


def test_build_outputs_attaches_each_photos_belief():
    atlas, _, _ = build_outputs(
        PHOTOS, systems(), beliefs={"kyoto": {"JP": 0.9}}, now="2026-10-10T00:00:00+00:00"
    )
    assert atlas["guesses"]["kyoto"]["belief"] == {"JP": 0.9}
    assert "belief" not in atlas["guesses"]["cusco"]


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

    images_encoded = 0  # across instances: how many images any FakeClip encoded

    def encode_images(self, paths):
        FakeClip.images_encoded += len(paths)
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


def run_main(tmp_path, monkeypatch, *extra):
    """Run the CLI offline on a two-photo catalog; returns (atlas.json path, results dir)."""
    catalog = tmp_path / "photos.csv"
    catalog.write_text(
        "id,image_url,lat,lon,place,country,author,license,source_url\n"
        "kyoto,https://x/kyoto.jpg,35.01,135.77,Kyoto,JP,A,CC0,https://x/k\n"
        "cusco,https://x/cusco.jpg,-13.53,-71.97,Cusco,PE,B,CC0,https://x/c\n"
    )
    geo = tmp_path / "geonames"
    geo.mkdir(exist_ok=True)
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
    images.mkdir(exist_ok=True)
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
            "--embedding-cache",
            str(tmp_path / "embeddings"),
            *extra,
        ]
    )
    return atlas_out, results


def test_main_runs_the_whole_pipeline_offline(tmp_path, monkeypatch):
    atlas_out, results = run_main(tmp_path, monkeypatch)
    atlas = json.loads(atlas_out.read_text())
    assert atlas["model"] == "Fake-1/test, country then city"
    assert atlas["guesses"]["kyoto"]["guessedPlace"] == "Kyoto, JP"
    looked = atlas["guesses"]["kyoto"]["looked"]
    # The fake lights every pixel alike, so no cell matters more than another: shape and range
    # are what this checks (test_saliency.py checks that maps find what a model uses).
    assert looked["grid"] == 7 and len(looked["cells"]) == 49
    assert all(0.0 <= v <= 1.0 for v in looked["cells"])
    assert atlas["evaluation"]["saliency"]["n"] == 2
    # The heatmap's distribution: Japan dominates the Kyoto photo, and the tail is trimmed.
    belief = atlas["guesses"]["kyoto"]["belief"]
    assert next(iter(belief)) == "JP" and belief["JP"] > 0.9
    assert all(p >= 0.005 for p in belief.values()) and set(belief) <= {"JP", "PE"}
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


def test_a_second_run_encodes_only_new_photos_and_guesses_the_same(tmp_path, monkeypatch):
    FakeClip.images_encoded = 0
    atlas_out, _ = run_main(tmp_path, monkeypatch)
    assert FakeClip.images_encoded == 2
    first = json.loads(atlas_out.read_text())

    FakeClip.images_encoded = 0
    atlas_out, _ = run_main(tmp_path, monkeypatch)
    assert FakeClip.images_encoded == 0, "cached embeddings must not be encoded again"
    second = json.loads(atlas_out.read_text())
    first.pop("generatedAt"), second.pop("generatedAt")
    assert second == first


def test_a_spent_saliency_budget_still_ships_every_guess(tmp_path, monkeypatch, capsys):
    atlas_out, _ = run_main(tmp_path, monkeypatch, "--saliency-budget-minutes", "0")
    atlas = json.loads(atlas_out.read_text())
    assert set(atlas["guesses"]) == {"kyoto", "cusco"}
    assert all("looked" not in g for g in atlas["guesses"].values())
    out = capsys.readouterr().out
    # The workflow reads this line to queue another run for the maps still missing.
    assert re.search(r"^saliency: 0 photos in \d+s; 2 left for a later run$", out, re.M)


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


def write_references(tmp_path):
    """Three reference "photos" near Kyoto (one of them a copy of the game photo's file) and
    three near Cusco; the fake encoder reads each thumbnail as text."""
    refs = tmp_path / "references.csv"
    rows = [
        ("wr1", 35.02, 135.76, "JP", "Kyoto", "https://x/k"),  # the game photo's own file
        ("wr2", 35.03, 135.78, "JP", "Kyoto", "https://c/2"),
        ("wr3", 34.99, 135.75, "JP", "Kyoto", "https://c/3"),
        ("wr4", 35.00, 135.77, "JP", "Kyoto", "https://c/4"),
        ("wr5", -13.52, -71.96, "PE", "Cusco", "https://c/5"),
        ("wr6", -13.54, -71.98, "PE", "Cusco", "https://c/6"),
        ("wr7", -13.50, -71.95, "PE", "Cusco", "https://c/7"),
    ]
    refs.write_text(
        "id,title,lat,lon,country,place,author,license,source_url,thumb_url\n"
        + "".join(
            f"{i},File:{i}.jpg,{a},{o},{c},{p},Z,CC0,{u},https://t/{i}.jpg\n"
            for i, a, o, c, p, u in rows
        )
    )
    thumbs = tmp_path / "ref-images"
    thumbs.mkdir()
    for i, *_rest, c, _p, _u in rows:
        (thumbs / f"{i}.jpg").write_text("Japan Kyoto" if c == "JP" else "Peru Cusco")
    return refs, thumbs


def fake_phash(monkeypatch, unreadable=()):
    """The fake "images" are text, so hash by file name: no two are near-duplicates."""
    import hashlib

    def phash(path):
        if path.name in unreadable:
            return None
        return int.from_bytes(hashlib.sha256(path.name.encode()).digest()[:8], "big")

    monkeypatch.setattr(run_atlas_v0, "_phash_or_none", phash)


def test_main_scores_the_retrieval_refinement_and_keeps_v0_unless_it_wins(
    tmp_path, monkeypatch, capsys
):
    fake_phash(monkeypatch, unreadable={"wr7.jpg"})
    refs, thumbs = write_references(tmp_path)
    atlas_out, results = run_main(
        tmp_path, monkeypatch, "--references", str(refs), "--reference-images", str(thumbs)
    )
    atlas = json.loads(atlas_out.read_text())
    record = atlas["evaluation"]["retrieval"]
    # v0 already guesses both photos exactly, so retrieval cannot clearly beat it.
    assert atlas["model"] == "Fake-1/test, country then city"
    assert record["ships"] is False
    assert record["references"] == 5 and record["countries"] == 2
    assert record["dropped"] == {"same file as a game photo": 1, "unreadable thumbnail": 1}
    # Cusco keeps two readable references, fewer than the three a move needs.
    assert record["moved"] == 1 and record["model"] == "Fake-1/test"
    names = {s["name"]: s["playsInGame"] for s in atlas["evaluation"]["systems"]}
    assert names["Fake-1/test, country then city, then nearest reference photos"] is False
    report = json.loads((results / "atlas-v0.json").read_text())
    assert report["retrieval"] == record
    assert "Retrieval refinement" in (results / "atlas-v0.md").read_text()
    assert "retrieval: moved the pin on 1 of 2 photos" in capsys.readouterr().out


def test_main_without_reference_thumbnails_skips_retrieval(tmp_path, monkeypatch):
    refs, thumbs = write_references(tmp_path)
    atlas_out, _ = run_main(
        tmp_path,
        monkeypatch,
        "--references",
        str(refs),
        "--reference-images",
        str(tmp_path / "none"),
    )
    assert "retrieval" not in json.loads(atlas_out.read_text())["evaluation"]


def test_a_failing_retrieval_still_ships_atlas_v0(tmp_path, monkeypatch, capsys):
    refs, thumbs = write_references(tmp_path)

    def broken(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(run_atlas_v0, "load_reference_index", broken)
    atlas_out, _ = run_main(
        tmp_path, monkeypatch, "--references", str(refs), "--reference-images", str(thumbs)
    )
    atlas = json.loads(atlas_out.read_text())
    assert set(atlas["guesses"]) == {"kyoto", "cusco"}
    assert "retrieval" not in atlas["evaluation"]
    assert "retrieval failed, shipping Atlas without it" in capsys.readouterr().err


def test_retrieval_model_must_be_one_of_the_runs(tmp_path, monkeypatch):
    refs, thumbs = write_references(tmp_path)
    with pytest.raises(SystemExit, match="not one of the --model runs"):
        run_main(
            tmp_path,
            monkeypatch,
            "--references",
            str(refs),
            "--reference-images",
            str(thumbs),
            "--retrieval-model",
            "Other:x",
        )


def test_main_calibrates_the_confidence_players_see_but_never_moves_a_pin(tmp_path, monkeypatch):
    atlas_out, results = run_main(tmp_path, monkeypatch)
    atlas = json.loads(atlas_out.read_text())
    cal = atlas["evaluation"]["calibration"]
    assert cal["method"] == "temperature scaling" and cal["n"] == 2
    assert {"nll", "ece", "bins"} <= set(cal["raw"]) and {"nll", "ece", "bins"} <= set(
        cal["calibrated"]
    )
    for g in atlas["guesses"].values():
        shortlist = [c["p"] for c in g["topCountries"]]
        # The reveal's "% sure" is the shortlist's first probability, still in order.
        assert g["confidence"] == pytest.approx(shortlist[0], abs=1e-4)
        assert shortlist == sorted(shortlist, reverse=True)
        assert next(iter(g["belief"])) == g["topCountries"][0]["country"]
    # The fake is right and already certain, so scaling has nothing to win and the raw ships.
    assert cal["ships"] is False
    assert cal["raw"]["nll"] >= 0.0
    assert atlas["guesses"]["kyoto"]["guessedPlace"] == "Kyoto, JP"
    report = json.loads((results / "atlas-v0.json").read_text())
    assert report["calibration"] == cal
    md = (results / "atlas-v0.md").read_text()
    assert "## How sure is Atlas: calibration" in md
    assert "the raw probabilities: temperature scaling did not lower held-out NLL" in md


def test_calibrate_guesses_keeps_the_raw_probabilities_when_calibration_loses():
    from whereabout_ml.gazetteer import City, Country, Gazetteer
    from whereabout_ml.zeroshot import ZeroShotGeolocator

    gaz = Gazetteer.build(
        [Country("JP", "Japan"), Country("PE", "Peru")],
        [City("Kyoto", "JP", 35.01, 135.77, 1), City("Cusco", "PE", -13.53, -71.97, 1)],
    )
    locator = ZeroShotGeolocator(FakeClip("Fake", "x"), gaz, top_k_countries=2)
    clip = FakeClip("Fake", "x")
    # Both photos look Japanese, but one is in Peru: a fit on either fold would teach the other
    # the wrong lesson, so the raw softmax ships and the guesses come back unchanged.
    embeddings = list(clip.encode_texts(["Japan Kyoto", "Japan Kyoto"]))
    guesses = [locator.predict(e) for e in embeddings]
    calibrated, beliefs, summary = run_atlas_v0.calibrate_guesses(
        PHOTOS, guesses, embeddings, locator
    )
    assert summary["ships"] is False
    for got, raw in zip(calibrated, guesses, strict=True):
        assert (got.lat, got.lon, got.city) == (raw.lat, raw.lon, raw.city)
        assert got.confidence == pytest.approx(raw.confidence)
        assert [c for c, _ in got.top_countries] == [c for c, _ in raw.top_countries]
    assert beliefs["kyoto"]["JP"] == round(guesses[0].confidence, 3)


def test_main_writes_pocket_atlas_its_own_calibration(tmp_path, monkeypatch, capsys):
    _, results = run_main(tmp_path, monkeypatch, "--pocket-model", "Fake-1:test")
    pocket = json.loads((results / "pocket-calibration.json").read_text())
    assert pocket["model"] == "Fake-1/test" and pocket["n"] == 2
    # The fake is certain and right: scaling cannot help held-out NLL, so T stays 1.
    assert pocket["ships"] is False and pocket["temperature"] == 1.0
    assert [b["lo"] for b in pocket["sureness"]] == [0.0, 0.2, 0.4, 0.6, 0.8]
    assert sum(b["n"] for b in pocket["sureness"]) == 2
    assert pocket["sureness"][-1] == {"lo": 0.8, "hi": 1.0, "n": 2, "right": 2}
    assert "pocket calibration (Fake-1/test)" in capsys.readouterr().out


def test_pocket_model_must_be_one_of_the_runs(tmp_path, monkeypatch):
    with pytest.raises(SystemExit, match="not one of --model"):
        run_main(tmp_path, monkeypatch, "--pocket-model", "Other:x")


def test_pocket_calibration_ships_a_temperature_and_counts_held_out_bands():
    from whereabout_ml.gazetteer import City, Country, Gazetteer
    from whereabout_ml.zeroshot import ZeroShotGeolocator

    gaz = Gazetteer.build(
        [Country("JP", "Japan"), Country("PE", "Peru")],
        [City("Kyoto", "JP", 35.01, 135.77, 1), City("Cusco", "PE", -13.53, -71.97, 1)],
    )
    clip = FakeClip("Fake", "x")
    locator = ZeroShotGeolocator(clip, gaz, top_k_countries=2)
    # 40 photos spread over the world, each a blend that leans the right way: CLIP's x100 scale
    # makes the raw model near-certain, yet a quarter lean the wrong way, so it is overconfident.
    rng = np.random.default_rng(0)
    jp, pe = clip.encode_texts(["Japan", "Peru"])
    photos, embeddings = [], []
    for i in range(40):
        in_japan = i % 2 == 0
        lean = 0.1 if i % 4 < 3 else -0.1
        w = 0.5 + (lean if in_japan else -lean)
        embeddings.append(w * jp + (1 - w) * pe + rng.normal(0, 0.005, jp.shape))
        photos.append(
            Photo(
                f"p{i}",
                LatLon(rng.uniform(-60, 60), rng.uniform(-180, 180)),
                "x",
                country="JP" if in_japan else "PE",
                image_url="https://x/p.jpg",
            )
        )
    pocket = run_atlas_v0.pocket_calibration(photos, embeddings, locator, "Fake/x")
    assert pocket["ships"] is True
    assert pocket["temperature"] == pocket["fittedTemperature"] > 1.0
    assert pocket["calibrated"]["nll"] < pocket["raw"]["nll"]
    assert sum(b["n"] for b in pocket["sureness"]) == 40
    assert sum(b["right"] for b in pocket["sureness"]) == 30
    # Held-out, softened probabilities: no longer all piled into the top band.
    assert pocket["sureness"][-1]["n"] < 40
