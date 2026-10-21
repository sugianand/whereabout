# 0002 — Ship a static demo that plays in the browser

**Status:** accepted · **Date:** 2026-10-09

## Context

The game should be playable from a public link today, at no cost, before the API has a host.
Decision 0001 keeps answers on the server so they can't be read before guessing.

## Decision

The web app has two backends behind one `GameBackend` interface (`web/src/lib/game/backends.ts`):

- **`ApiBackend`** — used when `NEXT_PUBLIC_API_URL` is set. Answers stay server-side until the
  guess, as in 0001.
- **`LocalBackend`** — used otherwise. The catalog ships with the static site and rounds
  are scored in the browser with the same formula as the API (`web/src/lib/geo.ts` is tested
  against the same reference values as `api/tests/test_geo.py`).

The public demo is a static export on GitHub Pages using `LocalBackend` and the **Daily Five**:
everyone gets the same five photos per UTC day, chosen by a seeded shuffle, so scores are
comparable without a server.

Atlas's guesses are precomputed offline (the "cold path" in `docs/architecture.md`) and
bundled as `web/src/data/atlas.json`, so the demo shows real model output without running a
model per visit.

Update (2026-10-21): the catalog grows with every Commons harvest, so the home page no longer
bundles `photos.json` and `atlas.json`. The build writes one static record per playable photo
(`out/game-data/<version>/<id>.json`: the photo and Atlas's guess, from
`web/src/app/game-data/[version]/[file]/route.ts`), the page ships only the list of playable ids
plus a content-hash version, and a game fetches the five records it deals
(`web/src/lib/game/deck.ts`). `npm run check-bundle` fails the build if catalog data reaches the
home page's scripts again.

## Consequences

- Zero hosting cost and no cold starts; the demo can't go down because a server did.
- The static demo can be cheated by reading the photo records it fetches. That's acceptable for a casual daily
  puzzle; competitive features (leaderboards, rooms) will require the API.
- Two backends must stay behaviourally identical; `web/src/lib/game/game.test.ts` covers both, and `data/fixtures/geo_cases.json` pins the scoring.
