"""Pocket Atlas's text index: quantization, layout, and agreement with the full pipeline."""

import json
from pathlib import Path

import numpy as np
import pytest
from test_zeroshot import GAZ, GROUPS, KeywordEncoder, image

from whereabout_ml.pocket_index import build_index, dequantize, locate, quantize, write_index
from whereabout_ml.zeroshot import ZeroShotGeolocator

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "fixtures" / "pocket_cases.json"
IMAGES = [("Peru", "Cusco"), ("Japan", "Kyoto"), ("Japan", "Osaka", "snow"), ("Peru", "desert")]
# Leans Japan, but not by much: the case where a temperature visibly changes "% sure".
UNSURE = [1.0, 0.001, 0.001, 0.985, 0.001, 0.001, 0.001, 0.001]
# A pocket-calibration.json for the toy model (`atlas-v0 --pocket-model`), T > 1: overconfident.
CALIBRATION = {
    "model": "keyword/toy",
    "temperature": 1.8,
    "sureness": [
        {"lo": 0.0, "hi": 0.2, "n": 0, "right": 0},
        {"lo": 0.2, "hi": 0.4, "n": 0, "right": 0},
        {"lo": 0.4, "hi": 0.6, "n": 12, "right": 5},
        {"lo": 0.6, "hi": 0.8, "n": 14, "right": 9},
        {"lo": 0.8, "hi": 1.0, "n": 30, "right": 27},
    ],
}


def toy(calibration=None):
    locator = ZeroShotGeolocator(KeywordEncoder(), GAZ, top_k_countries=2, concept_groups=GROUPS)
    meta, q = build_index(locator, "keyword/toy", calibration)
    return locator, meta, q


def test_int8_keeps_directions():
    rows = np.random.default_rng(0).normal(size=(50, 512))
    rows /= np.linalg.norm(rows, axis=1, keepdims=True)
    q, scale = quantize(rows)
    assert q.dtype == np.int8 and np.abs(q).max() == 127
    cos = (dequantize(q, scale) * rows).sum(axis=1)
    assert cos.min() > 0.999


def test_layout_is_countries_then_cities_then_clues():
    _, meta, q = toy()
    assert [c["code"] for c in meta["countries"]] == ["JP", "PE"]
    assert meta["countries"][0]["cities"] == [2, 2]
    assert meta["countries"][1]["cities"] == [4, 2]
    assert [c["name"] for c in meta["cities"]] == ["Osaka", "Kyoto", "Lima", "Cusco"]
    assert meta["clueGroups"] == [
        {"name": "climate", "labels": ["Snow and ice", "Desert"], "start": 6}
    ]
    assert q.shape == (meta["rows"], meta["dim"]) == (8, 8)
    assert len(meta["scales"]) == meta["rows"]


@pytest.mark.parametrize("words", IMAGES)
def test_index_guesses_like_the_full_pipeline(words):
    locator, meta, q = toy()
    full = locator.predict(image(*words))
    pocket = locate(meta, dequantize(q, np.array(meta["scales"])), image(*words))
    assert (pocket["city"], pocket["country"]) == (full.city, full.country)
    assert [c["country"] for c in pocket["topCountries"]] == [c for c, _ in full.top_countries]
    assert pocket["confidence"] == pytest.approx(full.confidence, abs=2e-3)
    assert [c["label"] for c in pocket["clues"]] == [c.label for c in full.clues]


def test_written_index_round_trips(tmp_path):
    _, meta, q = toy()
    write_index(tmp_path, meta, q)
    raw = np.frombuffer((tmp_path / "vectors.bin").read_bytes(), dtype=np.int8)
    assert np.array_equal(raw.reshape(meta["rows"], meta["dim"]), q)
    assert json.loads((tmp_path / "index.json").read_text())["countries"] == meta["countries"]


def test_temperature_softens_the_confidence_but_never_moves_the_pin():
    _, raw_meta, q = toy()
    _, meta, _ = toy(CALIBRATION)
    assert meta["temperature"] == 1.8 and meta["sureness"] == CALIBRATION["sureness"]
    vectors = dequantize(q, np.array(meta["scales"]))
    img = np.array(UNSURE)
    raw, tempered = locate(raw_meta, vectors, img), locate(meta, vectors, img)
    assert (tempered["city"], tempered["lat"], tempered["lng"]) == (
        raw["city"],
        raw["lat"],
        raw["lng"],
    )
    assert [c["country"] for c in tempered["topCountries"]] == ["JP", "PE"]
    assert 0.5 < tempered["confidence"] < raw["confidence"] < 1.0
    # p = softmax(logits / T): the log-odds between the two countries shrink by exactly T.
    log_odds = lambda g: np.log(g["topCountries"][0]["p"] / g["topCountries"][1]["p"])  # noqa: E731
    assert log_odds(tempered) == pytest.approx(log_odds(raw) / 1.8, rel=1e-3)
    assert tempered["clues"] == raw["clues"]


def test_an_index_without_calibration_is_the_raw_model():
    _, meta, _ = toy()
    assert "temperature" not in meta and "sureness" not in meta


def test_calibration_must_be_for_the_same_model_and_a_positive_temperature():
    with pytest.raises(ValueError, match="calibration is for"):
        toy({**CALIBRATION, "model": "ViT-L-14/openai"})
    with pytest.raises(ValueError, match="positive"):
        toy({**CALIBRATION, "temperature": 0})


def fixture_from_toy() -> dict:
    _, meta, q = toy(CALIBRATION)
    vectors = dequantize(q, np.array(meta["scales"]))
    return {
        "note": "Shared by ml/tests/test_pocket_index.py and web/src/lib/pocket/locate.test.ts. "
        "Regenerate with `python ml/tests/test_pocket_index.py`.",
        "meta": meta,
        "vectors": q.astype(int).tolist(),
        "cases": [
            {
                "image": [round(float(v), 6) for v in image(*w)],
                "expected": locate(meta, vectors, image(*w)),
            }
            for w in IMAGES
        ]
        + [{"image": UNSURE, "expected": locate(meta, vectors, np.array(UNSURE))}],
    }


def test_the_shared_fixture_is_current():
    # The browser's locate.ts is pinned to this file; it must match what Python computes now.
    assert json.loads(FIXTURE.read_text()) == json.loads(json.dumps(fixture_from_toy()))


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(fixture_from_toy(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
