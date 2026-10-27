"""Pocket Atlas: the text half of Atlas, precomputed, so the image half can run in a browser.

Zero-shot Atlas compares one image embedding with thousands of text embeddings ("a photo taken
in Peru.", "a photo taken in Cusco, Peru.", "a snow scene", ...). Text never changes, so this
script encodes all of it once, with the same CLIP model the browser uses for images
(OpenAI's ViT-B/32, run in the browser by transformers.js as `Xenova/clip-vit-base-patch32`),
and ships it as int8 vectors:

    pocket-atlas-index --gazetteer data/geonames --out web/public/pocket-atlas \\
                       --parity-image data/fixtures/parity.png

Outputs `index.json` (countries, cities, clue groups, per-row scales) and `vectors.bin`
(rows × dim int8, row-major: countries, then each country's cities, then clue options).

`locate()` below is the reference for web/src/lib/pocket/locate.ts: the same hierarchical
country-then-city math as `ZeroShotGeolocator.predict`, over the quantized vectors.

With `--calibration eval/results/pocket-calibration.json` (written by `atlas-v0 --pocket-model`)
the index also carries this model's own temperature, so the browser's "% sure" is scaled like the
game's, and the reality-check bands the reveal shows ("When Atlas is 60–80% sure, ...").

With `--gate data/scene_gate/pocket/thresholds.json` (written by `scene-gate --model
ViT-B-32:openai`, calibrated on the same model) the index carries the privacy gate: the scene
gate's people and indoor checks (`whereabout_ml.scene_gate`), so the browser declines a photo of
people or of a room before Atlas guesses where it was taken. Each check is linear in the image
embedding, `logit_scale * img . (reject_r - accept)`, so the index stores one direction per
reason, in full precision (two rows; int8 would move a score by about 0.1 log-odds). `screen()`
below is the reference for web/src/lib/pocket/gate.ts.

When `pocket-calibration.json` holds clue heads that won their paired comparison on this model
(`pocket_clue_heads` in `run_atlas_v0.py`), the index carries them too: logistic-regression probes
on the image embedding, as one affine map each (`clue_heads.export_probe`). `locate()` then takes
that concept's clue from the probe instead of the zero-shot scene descriptions ("Temperate
climate" in place of "Mediterranean"), or adds one no description reads ("Drives on the left").
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from whereabout_ml.belief import belief_from_probabilities
from whereabout_ml.clues import MIN_CLUE_PROBABILITY
from whereabout_ml.gazetteer import Gazetteer
from whereabout_ml.scene_gate import SceneGate
from whereabout_ml.zeroshot import LOGIT_SCALE, ZeroShotGeolocator, normalise, softmax

INDEX_VERSION = 1
HF_MODEL = "Xenova/clip-vit-base-patch32"

# The scene-gate reasons the browser checks before guessing: a photo of people would let Atlas
# say where those people are, and a photo of a room is usually someone's home. (The other reasons
# make a poor game round, but guessing them harms nobody, so Pocket Atlas still tries.)
PRIVACY_REASONS = ("people", "indoor")


def quantize(rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetric per-row int8: row ≈ q × scale, with scale = max |row| / 127."""
    rows = np.asarray(rows, dtype=np.float64)
    scale = np.abs(rows).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(rows / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def dequantize(q: np.ndarray, scale: np.ndarray) -> np.ndarray:
    """Back to unit vectors (quantization error removed from the norm, not the direction)."""
    return normalise(q.astype(np.float64) * np.asarray(scale, dtype=np.float64)[:, None])


def privacy_gate(encoder, model: str, gate: dict) -> dict:
    """The index's `gate` record from a scene-gate `thresholds.json` calibrated on `model`.

    One direction per privacy reason, `reject_r - accept` from the scene gate's own prompt
    ensembles, encoded by this index's text encoder: the browser's score is then
    `logitScale * image . direction`, exactly `SceneGate.score_embeddings`.
    """
    if gate.get("model") != model:
        raise ValueError(
            f"gate thresholds are for {gate.get('model')!r}, but this index is {model!r}"
        )
    if gate.get("score", "log-odds") != "log-odds":
        raise ValueError(f"gate thresholds must be log-odds, got {gate.get('score')!r}")
    thresholds = gate["thresholds"]
    scene = SceneGate(encoder, thresholds)
    reasons = []
    for r in PRIVACY_REASONS:
        t = float(thresholds[r])
        if not np.isfinite(t):
            raise ValueError(f"gate threshold for {r} must be a finite number, got {t!r}")
        direction = scene.reject_embeddings[r] - scene.accept_embedding
        reasons.append(
            {"name": r, "threshold": t, "direction": [round(float(v), 7) for v in direction]}
        )
    return {"logitScale": scene.logit_scale, "reasons": reasons}


def shipping_clue_heads(calibration: dict, dim: int) -> list[dict]:
    """The index's `clueHeads`: every head in `calibration` that ships, checked for shape."""
    heads = []
    for h in calibration.get("clueHeads") or []:
        if not h.get("ships"):
            continue
        probe = h.get("probe")
        if probe is None:
            raise ValueError(f"clue head {h['concept']} ships without its probe")
        classes = list(probe["classes"])
        weights = np.asarray(probe["weights"], dtype=np.float64)
        bias = np.asarray(probe["bias"], dtype=np.float64)
        if classes != list(h["classes"]) or weights.shape != (len(classes), dim):
            raise ValueError(
                f"clue head {h['concept']} has {weights.shape} weights, expected "
                f"{(len(h['classes']), dim)}"
            )
        if bias.shape != (len(classes),) or not (
            np.isfinite(weights).all() and np.isfinite(bias).all()
        ):
            raise ValueError(f"clue head {h['concept']} has a broken bias or weights")
        if "{}" not in h["clue"]:
            raise ValueError(f"clue head {h['concept']} has no place for its class in the clue")
        heads.append(
            {
                "concept": h["concept"],
                "group": h["clueGroup"],
                "clue": h["clue"],
                "classes": classes,
                "weights": probe["weights"],
                "bias": probe["bias"],
            }
        )
    return heads


def build_index(
    locator: ZeroShotGeolocator,
    model: str,
    calibration: dict | None = None,
    gate: dict | None = None,
) -> tuple[dict, np.ndarray]:
    """Every text embedding Atlas's zero-shot pipeline needs, and a description of the rows.

    `calibration` is `pocket_calibration`'s record for the same model; it must name that model,
    because a temperature fitted for one CLIP model means nothing for another. `gate` is a
    scene-gate `thresholds.json` for the same model, for the same reason (see `privacy_gate`).
    """
    if calibration is not None and calibration.get("model") != model:
        raise ValueError(
            f"calibration is for {calibration.get('model')!r}, but this index is {model!r}"
        )
    gaz = locator.gazetteer
    rows = [locator.country_embeddings]
    countries, cities = [], []
    start = len(gaz.countries)
    for country in gaz.countries:
        cs = gaz.cities_by_country[country.code]
        rows.append(locator._city_embeddings(country.code, country.name))
        countries.append({"code": country.code, "name": country.name, "cities": [start, len(cs)]})
        cities += [
            {"name": c.name, "country": c.country, "lat": round(c.lat, 5), "lng": round(c.lon, 5)}
            for c in cs
        ]
        start += len(cs)
    groups = []
    for group, emb in zip(locator.groups, locator.group_embeddings, strict=True):
        rows.append(emb)
        groups.append(
            {"name": group.name, "labels": [label for label, _ in group.options], "start": start}
        )
        start += len(group.options)

    q, scale = quantize(np.concatenate(rows))
    meta = {
        "version": INDEX_VERSION,
        "model": model,
        "hfModel": HF_MODEL,
        "dim": int(q.shape[1]),
        "rows": int(q.shape[0]),
        "logitScale": LOGIT_SCALE,
        "topKCountries": locator.top_k,
        "minClueProbability": MIN_CLUE_PROBABILITY,
        "countries": countries,
        "cities": cities,
        "clueGroups": groups,
        "scales": [float(f"{s:.6g}") for s in scale],
    }
    if calibration is not None:
        t = float(calibration["temperature"])
        if not (t > 0 and np.isfinite(t)):
            raise ValueError(f"temperature must be a positive number, got {t!r}")
        meta["temperature"] = t
        meta["sureness"] = calibration["sureness"]
        heads = shipping_clue_heads(calibration, int(q.shape[1]))
        if heads:
            meta["clueHeads"] = heads
    if gate is not None:
        meta["gate"] = privacy_gate(locator.encoder, model, gate)
    return meta, q


def screen(meta: dict, image: np.ndarray) -> dict:
    """The privacy gate's verdict on one image embedding (the reference for gate.ts).

    A reason is hit when its log-odds reach the threshold, as in `SceneGate.judge`; `reasons`
    keeps `PRIVACY_REASONS` order. An index without a gate has nothing to check with.
    """
    gate = meta.get("gate")
    if gate is None:
        raise ValueError("this index has no privacy gate")
    img = normalise(np.asarray(image, dtype=np.float64))
    scores = {
        r["name"]: float(gate["logitScale"]) * float(np.asarray(r["direction"]) @ img)
        for r in gate["reasons"]
    }
    hit = [r["name"] for r in gate["reasons"] if scores[r["name"]] >= r["threshold"]]
    return {
        "passed": not hit,
        "reasons": hit,
        "scores": {k: round(v, 3) for k, v in scores.items()},
    }


def locate(meta: dict, vectors: np.ndarray, image: np.ndarray) -> dict:
    """Atlas's guess from the index alone (the reference for the browser's locate.ts).

    The pin comes from the raw probabilities, exactly as the scored pipeline picks it; the
    reported "% sure", shortlist and heatmap (`belief`) are divided by the index's temperature,
    as in the game (`calibrate_guesses`), which never reorders countries.
    """
    img = normalise(np.asarray(image, dtype=np.float64))
    scale = float(meta["logitScale"])
    temperature = float(meta.get("temperature", 1.0))
    nc = len(meta["countries"])
    country_logits = scale * vectors[:nc] @ img
    p_raw = softmax(country_logits)
    p_country = softmax(country_logits / temperature)
    order = [int(i) for i in np.argsort(-p_raw, kind="stable")[: meta["topKCountries"]]]

    best: tuple[float, int] | None = None
    for i in order:
        s, n = meta["countries"][i]["cities"]
        p_city = softmax(scale * vectors[s : s + n] @ img)
        j = int(np.argmax(p_city))
        joint = float(p_raw[i] * p_city[j])
        if best is None or joint > best[0]:
            best = (joint, s + j)
    assert best is not None
    city = meta["cities"][best[1] - nc]

    # A clue head replaces the zero-shot clue of its group, shown or not: it read it better.
    heads = meta.get("clueHeads") or []
    learned = {h["group"] for h in heads}
    clues = []
    for g in meta["clueGroups"]:
        if g["name"] in learned:
            continue
        p = softmax(scale * vectors[g["start"] : g["start"] + len(g["labels"])] @ img)
        k = int(np.argmax(p))
        if p[k] >= meta["minClueProbability"]:
            clues.append({"label": g["labels"][k], "p": round(float(p[k]), 4)})
    for h in heads:
        p = softmax(np.asarray(h["weights"], dtype=np.float64) @ img + np.asarray(h["bias"]))
        k = int(np.argmax(p))
        if p[k] >= meta["minClueProbability"]:
            clues.append({"label": h["clue"].format(h["classes"][k]), "p": round(float(p[k]), 4)})
    return {
        "city": city["name"],
        "country": city["country"],
        "lat": city["lat"],
        "lng": city["lng"],
        "confidence": round(float(p_country[order[0]]), 4),
        "topCountries": [
            {"country": meta["countries"][i]["code"], "p": round(float(p_country[i]), 4)}
            for i in order
        ],
        "clues": sorted(clues, key=lambda c: -c["p"]),
        # The heatmap over every country, from the same tempered probabilities as "% sure".
        "belief": belief_from_probabilities([c["code"] for c in meta["countries"]], p_country),
    }


def write_index(out: Path, meta: dict, q: np.ndarray) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "vectors.bin").write_bytes(np.ascontiguousarray(q, dtype=np.int8).tobytes())
    (out / "index.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))


def main(argv: Sequence[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--gazetteer", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--model", default="ViT-B-32:openai", help="open_clip MODEL:PRETRAINED")
    ap.add_argument(
        "--parity-image",
        type=Path,
        help="also store this image's embedding, so a browser test can check its encoder agrees",
    )
    ap.add_argument(
        "--calibration",
        type=Path,
        help="pocket-calibration.json from `atlas-v0 --pocket-model`: this model's temperature "
        "and reality-check bands",
    )
    ap.add_argument(
        "--gate",
        type=Path,
        help="thresholds.json from `scene-gate --model` with this model: the privacy gate "
        "(people and indoor) the browser runs before guessing",
    )
    args = ap.parse_args(argv)

    from whereabout_ml.clip_encoder import ClipEncoder

    name, _, pretrained = args.model.partition(":")
    encoder = ClipEncoder(name, pretrained)
    locator = ZeroShotGeolocator(encoder, Gazetteer.load(args.gazetteer))
    calibration = json.loads(args.calibration.read_text()) if args.calibration else None
    gate = json.loads(args.gate.read_text()) if args.gate else None
    meta, q = build_index(locator, encoder.name, calibration, gate)
    if args.parity_image:
        emb = encoder.encode_images([args.parity_image])[0]
        meta["parity"] = {
            "image": args.parity_image.name,
            "embedding": [round(float(v), 6) for v in emb],
            "guess": locate(meta, dequantize(q, np.array(meta["scales"])), emb),
        }
        if gate is not None:
            meta["parity"]["gate"] = screen(meta, emb)
    write_index(args.out, meta, q)
    print(
        f"pocket index: {meta['rows']} rows × {meta['dim']} ({q.nbytes / 1e6:.1f} MB), "
        f"T = {meta.get('temperature', 1.0)}, "
        f"{'privacy gate on' if gate is not None else 'no privacy gate'} → {args.out}"
    )


if __name__ == "__main__":
    main()
