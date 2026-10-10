# 0003 — Explain Atlas with occlusion, and test the explanation

**Status:** accepted · **Date:** 2026-10-10

## Context

Players see Atlas's guess and its clues; the obvious next question is *what in the photo made it
think that?* A heatmap answers it at a glance, but heatmaps are easy to make and easy to make
wrong. Attention maps from a ViT show where attention weights are large, which is not the same as
what the prediction depends on.

## Decision

- Use **occlusion saliency** for the system that plays: split the 224 px square CLIP sees into a
  7 × 7 grid, grey out one cell at a time (zero in CLIP's normalised space, i.e. the dataset's
  mean colour), and record the drop in log p(the country Atlas chose).
- **Test faithfulness with a deletion test**: hide the 5 highest-ranked cells, and separately 5
  random cells (mean of 3 draws); report the mean relative drop in p(country) for each and the
  share of photos where the top cells mattered more. The numbers are shown on the site only once
  a real run produces them.
- Show the map over **the crop CLIP actually saw**, not the full photo, so the picture never
  implies the model looked at parts it never received.

## Consequences

- About 50 forward passes per photo. Maps are cached per (model, photo, grid, guessed country,
  method version), so only new or re-guessed photos cost anything on later runs.
- A 7 × 7 grid is coarse; it can point at "the sign" or "the roofline", not a single letter.
- Saliency failures never block Atlas's guesses: the run warns and ships without maps.
