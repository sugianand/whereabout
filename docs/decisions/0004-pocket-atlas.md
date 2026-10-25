# 0004 — Pocket Atlas: precomputed text, image encoder in the browser

**Status:** accepted · **Date:** 2026-10-10

## Context

"Test Atlas on your own photo" is the most personal thing the site can offer, and the most
sensitive: people's own photos. A server would need GPUs (or slow CPUs), cost money per photo,
and hold uploads. The project's rule is that no visit waits on, or pays for, a server model.

## Decision

- **Split CLIP in two.** Zero-shot Atlas compares one image embedding with thousands of fixed
  text embeddings. The text side never changes, so `pocket-atlas-index` embeds every country,
  city and clue prompt once in GitHub Actions and ships them as per-row-scaled int8 vectors.
- **Run the image side in the browser** with transformers.js (`Xenova/clip-vit-base-patch32`,
  8-bit, WebAssembly). The photo is decoded, embedded and matched on the device and never sent
  anywhere.
- **Load transformers.js from a pinned CDN build, not npm.** Its npm package depends on
  Node-only native modules (`onnxruntime-node`, `sharp`) that a static site never runs and whose
  install scripts download binaries. Use the self-contained `dist/transformers.min.js`, which
  bundles ONNX Runtime; `transformers.web.min.js` imports it by bare name and fails in a browser
  without an import map.
- **Port, then pin.** `web/src/lib/pocket/locate.ts` ports `pocket_index.locate()`; both test
  suites check the same fixture (`data/fixtures/pocket_cases.json`).
- **Prove the halves match.** Before the index ships, the Atlas workflow uploads a catalog
  photo in real Chromium and compares transformers.js's embedding with PyTorch's (cosine ≥ 0.95).
- Use **ViT-B/32 (OpenAI)**, not the ViT-L/14 that plays in the game: the large model is too
  big to download on a phone. Its accuracy is measured in the same evaluation and labelled on the
  site as the Pocket Atlas row.
- **Its own temperature.** The game's calibration temperature is fitted for the model that plays,
  so Pocket Atlas gets one fitted the same way for ViT-B/32 (`atlas-v0 --pocket-model`), carried
  in the index with the held-out "When Atlas is 60–80% sure" bands the reveal shows.

## Consequences

- First use downloads the vision model (tens of MB) from the Hugging Face Hub; it is cached
  after that. The UI says so before it starts.
- The site depends on two third-party hosts at runtime for this one page (jsDelivr, the Hub).
  The game itself does not.
- Pocket Atlas is less accurate than game Atlas, and the site says that plainly.
