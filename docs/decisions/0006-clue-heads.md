# 0006 — Clue heads write a reveal clue only where they beat today's

**Status:** accepted · **Date:** 2026-10-26

## Context

The reveal's clues ("Temperate 73%") are zero-shot: CLIP compares the photo with a handful of
scene descriptions. The architecture plans trained clue heads with labels derived from maps
(docs/architecture.md). Fine-tuning CLIP needs a GPU, but a linear probe on frozen embeddings
fits on the CPU runner, and the reference photos (`data/reference/`, never game photos) already
have cached embeddings and coordinates.

## Decision

- **Two concepts first: the driving side and the Köppen climate group.** Both follow from
  coordinates (`labels.py`, `maps.py`), so thousands of reference photos are labelled with no
  hand work. Land cover is left out: labelling thousands of points needs hundreds of 10 m tiles.
- **A multinomial logistic-regression probe** on standardised ViT-B/32 (LAION-2B) embeddings, the
  space the reference photos are already embedded in for retrieval. Its L2 penalty is picked
  from a fixed grid by geographic cross-validation over the reference photos alone.
- **Scored on places it never trained on.** Reference and game photos are dealt into folds by
  10° geographic blocks; each game photo is predicted by a probe fitted on references from the
  other folds, and scored against its own map label (`data/labels/concept_labels.csv`).
- **Compared with what plays today.** Climate: the zero-shot climate clue's top option mapped to
  a Köppen group (`ZERO_SHOT_CLIMATE`). Driving side, which no zero-shot clue reads: the side of
  the road in the country Atlas guessed. Both answer every photo, as the probe does.
- **Ship rule.** A paired bootstrap of the accuracy difference on the same photos must put its
  whole 95% interval above zero. Then the probe fitted on every reference photo writes that
  concept's clue (the zero-shot climate clue is replaced; a driving-side clue is added), shown,
  like any clue, only at 55% or more.

## Consequences

- The country-derived driving side is a strong baseline when Atlas's country is right, so the
  driving-side head may not ship; the run says so either way.
- Results come only from the Atlas workflow run (`eval/results/atlas-v0.md`, "How Atlas
  guesses"). The reference labels are written by `labels.yml`, which queues an Atlas run when
  they change.
- Pocket Atlas (in the browser) keeps its zero-shot clues; porting a shipped probe's weights
  there is a separate step.
