"""Pocket Atlas's text index: quantization, layout, and agreement with the full pipeline."""

import json
from pathlib import Path

import numpy as np
import pytest
from test_zeroshot import GAZ, GROUPS, VOCAB, KeywordEncoder, image

from whereabout_ml.pocket_index import (
    PRIVACY_REASONS,
    build_index,
    dequantize,
    locate,
    quantize,
    screen,
    write_index,
)
from whereabout_ml.scene_gate import ACCEPT_PROMPTS, REJECT_PROMPTS, SceneGate
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


# The privacy gate's toy: three more axes, for photos of people, of rooms and of the outdoors.
GATE_VOCAB = [*VOCAB, "person", "room", "outdoors"]
# The scene gate's own prompts land on those axes: people, indoor and "good photo".
GATE_AXIS = (
    {p: "person" for p in REJECT_PROMPTS["people"]}
    | {p: "room" for p in REJECT_PROMPTS["indoor"]}
    | {p: "outdoors" for p in ACCEPT_PROMPTS}
)
# A scene-gate thresholds.json for the toy model (`scene-gate --model`), log-odds.
GATE = {
    "thresholds": {"people": 5.0, "indoor": 8.0, "text": 1.0, "not_photo": 1.0, "close_up": 1.0},
    "score": "log-odds",
    "model": "keyword/toy",
    "max_false_reject": 0.0,
}
GATE_IMAGES = [
    ("Peru", "Cusco", "outdoors"),
    ("Japan", "Kyoto", "person"),
    ("Japan", "Osaka", "room"),
    ("Peru", "Lima", "person", "room"),
]


class GateKeywordEncoder(KeywordEncoder):
    def encode_texts(self, texts):
        out = np.full((len(texts), len(GATE_VOCAB)), 1e-3)
        for i, t in enumerate(texts):
            for j, w in enumerate(GATE_VOCAB):
                if w in t or GATE_AXIS.get(t) == w:
                    out[i, j] = 1.0
        return out / np.linalg.norm(out, axis=1, keepdims=True)


def gate_image(*words: str) -> np.ndarray:
    v = np.full(len(GATE_VOCAB), 1e-3)
    for w in words:
        v[GATE_VOCAB.index(w)] = 1.0
    return v


def gated_toy(calibration=CALIBRATION, gate=GATE):
    encoder = GateKeywordEncoder()
    locator = ZeroShotGeolocator(encoder, GAZ, top_k_countries=2, concept_groups=GROUPS)
    meta, q = build_index(locator, "keyword/toy", calibration, gate)
    return encoder, meta, q


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


def test_the_heatmap_is_the_tempered_country_distribution_like_the_game():
    # Pocket Atlas shades the globe from the same probabilities as its "% sure", in the same
    # compact form as the game's atlas.json (belief_from_probabilities).
    _, meta, q = toy(CALIBRATION)
    vectors = dequantize(q, np.array(meta["scales"]))
    unsure = locate(meta, vectors, np.array(UNSURE))
    assert list(unsure["belief"]) == ["JP", "PE"]
    assert unsure["belief"]["JP"] == round(unsure["confidence"], 3)
    assert sum(unsure["belief"].values()) == pytest.approx(1, abs=2e-3)
    # A sure guess drops the countries below half a percent.
    sure = locate(meta, vectors, image("Peru", "Cusco"))
    assert sure["belief"] == {"PE": 1.0}


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


def test_an_index_without_a_gate_has_none_to_screen_with():
    _, meta, _ = toy()
    assert "gate" not in meta
    with pytest.raises(ValueError, match="no privacy gate"):
        screen(meta, image("Peru"))


def test_the_gate_carries_only_the_privacy_reasons_with_their_thresholds():
    _, meta, _ = gated_toy()
    reasons = meta["gate"]["reasons"]
    assert [r["name"] for r in reasons] == list(PRIVACY_REASONS) == ["people", "indoor"]
    assert [r["threshold"] for r in reasons] == [5.0, 8.0]
    assert all(len(r["direction"]) == meta["dim"] for r in reasons)


@pytest.mark.parametrize("words", GATE_IMAGES)
def test_the_gate_scores_like_the_scene_gate(words):
    encoder, meta, _ = gated_toy()
    img = gate_image(*words)
    full = SceneGate(encoder, GATE["thresholds"]).screen(img)[0]
    pocket = screen(meta, img)
    for r in PRIVACY_REASONS:
        assert pocket["scores"][r] == pytest.approx(full.scores[r], abs=1e-3)
    assert pocket["reasons"] == [r for r in full.reasons if r in PRIVACY_REASONS]
    assert pocket["passed"] == (not pocket["reasons"])


def test_the_gate_declines_people_and_rooms_and_passes_places():
    _, meta, _ = gated_toy()
    verdict = lambda *w: screen(meta, gate_image(*w))["reasons"]  # noqa: E731
    assert verdict("Peru", "Cusco", "outdoors") == []
    assert verdict("Japan", "Kyoto", "person") == ["people"]
    assert verdict("Japan", "Osaka", "room") == ["indoor"]
    assert verdict("Peru", "Lima", "person", "room") == ["people", "indoor"]


def test_a_score_at_the_threshold_is_declined():
    # Like SceneGate.judge: rejected when the score *reaches* the threshold.
    _, meta, _ = gated_toy()
    img = gate_image("Japan", "Kyoto", "person")
    at = screen(meta, img)["scores"]["people"]
    exact = {**GATE, "thresholds": {**GATE["thresholds"], "people": at}}
    _, meta_at, _ = gated_toy(gate=exact)
    assert "people" in screen(meta_at, img)["reasons"]
    above = {**GATE, "thresholds": {**GATE["thresholds"], "people": at + 0.01}}
    _, meta_above, _ = gated_toy(gate=above)
    assert screen(meta_above, img)["passed"]


def test_gate_thresholds_must_be_for_the_same_model():
    with pytest.raises(ValueError, match="gate thresholds are for"):
        gated_toy(gate={**GATE, "model": "ViT-B-32/laion2b_s34b_b79k"})
    with pytest.raises(ValueError, match="log-odds"):
        gated_toy(gate={**GATE, "score": "probability"})
    with pytest.raises(ValueError, match="finite"):
        gated_toy(gate={**GATE, "thresholds": {**GATE["thresholds"], "indoor": float("nan")}})


def fixture_from_toy() -> dict:
    _, meta, q = gated_toy()
    vectors = dequantize(q, np.array(meta["scales"]))
    images = [gate_image(*w) for w in IMAGES + GATE_IMAGES] + [np.array(UNSURE + [0.001] * 3)]
    return {
        "note": "Shared by ml/tests/test_pocket_index.py and web/src/lib/pocket/locate.test.ts "
        "and gate.test.ts. Regenerate with `python ml/tests/test_pocket_index.py`.",
        "meta": meta,
        "vectors": q.astype(int).tolist(),
        "cases": [
            {
                "image": [round(float(v), 6) for v in img],
                "expected": locate(meta, vectors, img),
                "gate": screen(meta, img),
            }
            for img in images
        ],
    }


def test_the_shared_fixture_is_current():
    # The browser's locate.ts is pinned to this file; it must match what Python computes now.
    assert json.loads(FIXTURE.read_text()) == json.loads(json.dumps(fixture_from_toy()))


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(fixture_from_toy(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
