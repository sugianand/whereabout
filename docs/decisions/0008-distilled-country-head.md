# 0008 — Pocket Atlas's countries can be taught by the game's Atlas, if that wins

**Status:** accepted · **Date:** 2026-10-28

## Context

"Try Atlas on your photo" runs ViT-B/32 (OpenAI) in the browser and names countries zero-shot,
from text prompts. The game's Atlas plays ViT-L/14, whose calibrated country probabilities are
better, but a ~900 MB model is too much for a phone. Knowledge distillation trains a small model
to reproduce a large one's output distribution; here only a small head is trained, on frozen
ViT-B/32 embeddings, so it fits the CPU runner like the clue and geocell heads.

## Decision

- **Teacher targets, not labels.** Every reference photo (past the retrieval leakage guard,
  never a game photo) is embedded by the playing model; its country distribution, divided by the
  game's own fitted temperature (`calibrate_guesses`), is the soft target. The head learns the
  teacher's uncertainty between look-alike countries as well as its top choice.
- **A correction to today's Pocket Atlas.** Student logits = Pocket Atlas's zero-shot logits /
  its temperature + a linear probe on the unit-length ViT-B/32 embedding (`fit_soft_probe` with
  `offset`). The L2 penalty pulls the probe to zero, so the strongest penalty is exactly what the
  browser shows today, and countries the references barely cover keep their text prior.
- **No game photo is used for fitting or tuning.** L2 ∈ {0.01, 0.1, 1} is chosen by the lowest
  held-out cross-entropy against the teacher over 10° geographic folds of the reference photos.
  Each game photo is scored by a student fitted on reference photos outside its own fold.
- **Ship rule.** On the catalog photos whose country the gazetteer knows: the paired-bootstrap
  95% interval of per-photo NLL (student minus today) must be entirely below zero, top-1
  accuracy must not drop, and the pin that the student's countries lead to (the same city step)
  must not be clearly further away (the paired median-distance interval must reach zero). NLL
  leads because the head exists to change "% sure" and the shortlist, and NLL is the proper
  score for a whole distribution.
- **Scored first, shipped separately.** `atlas-v0` writes the verdict to
  `pocket-calibration.json` as `distillation` (with the head as one affine map only when it
  ships) and to `eval/results/atlas-v0.md`. Putting the head in the browser's index is a later
  step that runs only on a yes.
- **The teacher's reference embeddings fill in over runs.** ViT-L/14 on ~4,000 thumbnails is
  the slow part on a CPU runner, so they are encoded a chunk at a time through the embedding
  cache under `--distill-budget-minutes`; the head waits for a run that has them all rather than
  learning from a geographically lopsided part.

## Consequences

- The teacher's temperature and Pocket Atlas's own are each fitted on the catalog photos, one
  scalar each; the baseline shares that, so the comparison stays paired and fair.
- A student taught by the teacher can at best inherit its mistakes; the results page reports
  the teacher's own NLL and accuracy on the same photos for context.
- About 125,000 weights (one 512-wide row per country) would ship if it wins: roughly 1.5 MB as
  JSON in the index, or less as int8 in the browser step.
