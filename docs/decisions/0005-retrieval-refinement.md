# 0005 — Retrieval refinement ships only if it beats Atlas v0

**Status:** accepted · **Date:** 2026-10-22

## Context

Atlas v0 knows places only through text prompts ("a photo taken in Kyoto, Japan."), so within a
country its pin lands on one of the 40 largest cities even when the photo shows a valley far
from any of them. Retrieval (Im2GPS, PIGEON) places a photo where similar geotagged photos were
taken. It needs a reference set, and it needs to be judged honestly: the game should not switch
to a system that only looks better on the photos that happened to be drawn.

## Decision

- **Refine, don't replace.** Keep Atlas v0's country; search only reference photos in it; move
  the pin to the similarity-weighted geographic medoid of the 10 nearest look-alikes. With fewer
  than 3 references in the country, the v0 guess stands. Country, confidence, shortlist and
  clues stay v0's, so the reveal still explains the country choice.
- **References are never game photos.** Seeds come from GeoNames, not from game locations;
  game and harvested files are excluded by title; a leakage guard drops near-duplicates and
  same-photographer shots near a game photo before every run.
- **Fixed settings, not tuned.** `k = 10`, temperature 0.05, at least 3 references: chosen
  before any run, because the only labelled photos are the ones the refinement is evaluated on.
- **Image similarity from ViT-B/32 (LAION-2B),** the cheapest model the workflow already runs:
  the references are encoded once and cached, while the country still comes from the model that
  plays in the game.
- **Ship rule.** The refined system is scored in the same table. It plays in the game only if
  the paired bootstrap's 95% interval for (refined − unrefined) median error is entirely below
  zero. Otherwise the table and the "How Atlas guesses" page say it did not clearly win.

## Consequences

- The reference set is small (Commons, a few thousand photos at most) and dense only where
  Commons is, so the refinement may not win at first. The result, either way, comes from a real
  run in `eval/results/atlas-v0.md`.
- Seeds and settings are fixed, so a run is reproducible; `reference-set --refresh` searches
  Commons again.
- The leakage guard uses game photos' authors and locations, but only to remove references.
