# 0001 — Score guesses on the server, never send answers early

**Status:** accepted · **Date:** 2026-10-09

## Context

A geography game is trivial to cheat if the true location of a photo reaches the browser
before the player guesses (network tab, page source).

## Decision

- The API sends only the photo and round id when a round starts.
- The true location is returned **only** in the response to a guess, together with the score.
- Distance and score are computed server-side with the same functions used by the evaluation
  harness, so player scores and Atlas's benchmark numbers use one definition of "distance".

## Consequences

- One extra round trip per reveal (acceptable; the reveal is animated anyway).
- Scoring logic lives in one tested module (`whereabout_api.geo`).
