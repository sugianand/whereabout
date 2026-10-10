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
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from whereabout_ml.clues import MIN_CLUE_PROBABILITY
from whereabout_ml.gazetteer import Gazetteer
from whereabout_ml.zeroshot import LOGIT_SCALE, ZeroShotGeolocator, normalise, softmax

INDEX_VERSION = 1
HF_MODEL = "Xenova/clip-vit-base-patch32"


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


def build_index(locator: ZeroShotGeolocator, model: str) -> tuple[dict, np.ndarray]:
    """Every text embedding Atlas's zero-shot pipeline needs, and a description of the rows."""
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
    return meta, q


def locate(meta: dict, vectors: np.ndarray, image: np.ndarray) -> dict:
    """Atlas's guess from the index alone (the reference for the browser's locate.ts)."""
    img = normalise(np.asarray(image, dtype=np.float64))
    scale = float(meta["logitScale"])
    nc = len(meta["countries"])
    p_country = softmax(scale * vectors[:nc] @ img)
    order = [int(i) for i in np.argsort(-p_country, kind="stable")[: meta["topKCountries"]]]

    best: tuple[float, int] | None = None
    for i in order:
        s, n = meta["countries"][i]["cities"]
        p_city = softmax(scale * vectors[s : s + n] @ img)
        j = int(np.argmax(p_city))
        joint = float(p_country[i] * p_city[j])
        if best is None or joint > best[0]:
            best = (joint, s + j)
    assert best is not None
    city = meta["cities"][best[1] - nc]

    clues = []
    for g in meta["clueGroups"]:
        p = softmax(scale * vectors[g["start"] : g["start"] + len(g["labels"])] @ img)
        k = int(np.argmax(p))
        if p[k] >= meta["minClueProbability"]:
            clues.append({"label": g["labels"][k], "p": round(float(p[k]), 4)})
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
    args = ap.parse_args(argv)

    from whereabout_ml.clip_encoder import ClipEncoder

    name, _, pretrained = args.model.partition(":")
    encoder = ClipEncoder(name, pretrained)
    locator = ZeroShotGeolocator(encoder, Gazetteer.load(args.gazetteer))
    meta, q = build_index(locator, encoder.name)
    if args.parity_image:
        emb = encoder.encode_images([args.parity_image])[0]
        meta["parity"] = {
            "image": args.parity_image.name,
            "embedding": [round(float(v), 6) for v in emb],
            "guess": locate(meta, dequantize(q, np.array(meta["scales"])), emb),
        }
    write_index(args.out, meta, q)
    print(
        f"pocket index: {meta['rows']} rows × {meta['dim']} ({q.nbytes / 1e6:.1f} MB) → {args.out}"
    )


if __name__ == "__main__":
    main()
