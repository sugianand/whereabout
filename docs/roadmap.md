# Build roadmap

One box is roughly one day of work and one to three commits. The daily build job takes the
first unchecked step that is not marked **[needs you]**, builds it with tests, ticks the box
and pushes. Steps marked **[needs you]** require a GPU, a large dataset download, an account
or a judgment call, so the job skips them and leaves a note under "Waiting on you" instead.

Rules for every step: tests pass, lint passes, small conventional commits, and no invented
numbers anywhere. Benchmark results only appear when produced by `eval/` from a real run.

## Milestone 1 — Playable shell

- [x] Repository, README, license, architecture notes
- [x] Geo core: haversine distance, scoring, tests
- [x] Rounds API: start round, single guess, server-side scoring
- [x] CI: lint and test the API
- [x] Web: Next.js + TypeScript + Tailwind app in `web/`, lint + type-check + build job in CI
- [x] Web: interactive globe (MapLibre GL, globe projection) with click-to-place pin
- [x] Web: game loop wired to the API — start round, guess, reveal the true location and a distance line
- [x] API: settings from environment, CORS for the web app, Dockerfile, `docker-compose.yml` for local dev
- [x] Web: five-round game with a summary screen
- [x] Web: Playwright end-to-end test of a full game in a real browser, run in CI
- [x] Data: photo catalog loaded from `data/curation/photos.csv` (id, image URL, lat, lon, place, author, license) with validation, replacing the dev fixtures
- [x] Curate the first 50 openly licensed photos (88 curated) into `photos.csv` (Wikimedia Commons, CC BY / CC BY-SA / CC0), outdoor, no people

## Milestone 2 — Atlas v0 and the evaluation harness

- [x] Eval: metrics module (accuracy at 1/25/200/750/2500 km, median error with bootstrap CI, mean game score, country accuracy, paired bootstrap between systems) built on `whereabout_api.geo`, with tests
- [x] ML: hierarchical zero-shot CLIP (country, then city) behind an `Encoder` protocol, with tests using a stub encoder, a country-only ablation and two baselines
- [x] CI: `atlas.yml` runs Atlas v0 on a GitHub runner, compares two CLIP models, commits `web/src/data/atlas.json` and `eval/results/atlas-v0.{json,md}`
- [x] Web: reveal animation with Atlas's pin, both arcs, both distances and Atlas's clues
- [x] Web: "How Atlas works" page that explains the pipeline with the real results table
- [x] API: the guess response includes Atlas's precomputed guess, distance and score, so the API backend plays against Atlas too
- [x] Eval: per-continent breakdown and a failure gallery (the photos Atlas missed by most) in the results page
- [ ] **[needs you]** Download Im2GPS3k / YFCC4k test sets and run the first public benchmark

## Milestone 3 — Data pipeline

- [ ] Geocells: adaptive S2 cell builder with tests (cells split until each has enough images)
- [ ] Labels: concept-label derivation from coordinates — driving side by country, with tests
- [ ] Labels: climate-zone and land-cover lookups from raster maps behind one interface, with tests on known coordinates
- [ ] Data: ingestion pipeline for image metadata (license capture, perceptual-hash dedupe) on a small sample
- [ ] Data: geographic-block train/validation split with a leakage test
- [ ] **[needs you]** Pull 1–5M openly licensed training images (OSV-5M / MP-16) to storage

## Milestone 4 and beyond

See `docs/architecture.md` and the design doc: trained geocell classifier with distance-aware
loss, clue heads, retrieval refinement, calibration, privacy gate, Daily Five, rooms,
distillation, deployment, research write-up. New daily-sized steps get added here as each
milestone starts.

## Waiting on you

(The daily job lists blocked steps here with what it needs.)

- **Turn on GitHub Pages** (Settings → Pages → Source: GitHub Actions). The deploy workflow
  builds and tests the site on every push and publishes it as soon as Pages is enabled; until
  then it skips the deploy step.
