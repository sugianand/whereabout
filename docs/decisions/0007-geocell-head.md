# 0007 — A trained geocell head places the pin only where it beats Atlas v0

**Status:** accepted · **Date:** 2026-10-26

## Context

Atlas v0 places its pin from text prompts, so within the right country it lands on one of the
country's 40 largest cities. The architecture's Atlas v1 is a geocell classifier with
distance-aware label smoothing (docs/architecture.md). Fine-tuning CLIP needs a GPU, but a
linear head on frozen embeddings of the ~4,000 reference photos fits on the CPU runner.

## Decision

- **Classes: adaptive geocells** (`geocells.py`) over the reference photos that pass the
  leakage guard: a cell splits above 100 photos, and a leaf needs 10 to be a class.
- **A linear softmax head** on the retrieval model's normalised image embeddings, trained on
  haversine-smoothed targets (`soft_targets`, q ∝ exp(−(d(cᵢ, y) − d(c_true, y))/τ)) with the
  clue heads' accelerated gradient solver (`fit_soft_probe`).
- **The pin minimises expected distance** Σᵢ pᵢ·d(cᵢ, x) over the candidates, rather than
  taking the likeliest cell.
- **Two systems are scored.** *Alone*: candidates are every cell's centroid. *Within Atlas's
  country*: Atlas v0 keeps its country, and the candidates are, for each cell holding reference
  photos from that country, the spherical mean of those photos. Only the second can play,
  because Atlas's "% sure", shortlist, heatmap and calibration bands are about its country; a
  pin in another country would contradict them. A country with fewer than 3 reference photos
  keeps v0's pin.
- **No game photo is used for fitting or tuning.** L2 ∈ {0.001, 0.01, 0.1} and τ ∈ {100, 300}
  km are chosen by the lowest held-out median error over 10° geographic folds of the reference
  photos (with the cells fixed). The final head is fitted on every reference photo and scored
  once on the game photos.
- **Ship rule** (the retrieval refinement's): the paired-bootstrap 95% interval of the
  in-country head's median error minus the playing system's must be entirely below zero.

## Consequences

- Geographic folds are strict: a held-out block's own cells get no training photos, so the
  selection leans towards smoother heads than random folds would. That costs accuracy, not
  honesty.
- The head reads ViT-B/32 embeddings while v0 plays ViT-L/14, and ~4,000 photos over ~100+ cells
  is little data; it may well not ship. The run says so either way (`eval/results/atlas-v0.md`,
  "How Atlas guesses").
- Results come only from the Atlas workflow run; nothing here is a measured number.
