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
- [ ] Web: interactive globe (MapLibre GL, globe projection) with click-to-place pin
- [ ] Web: game loop wired to the API — start round, guess, reveal the true location and a distance line
- [x] API: settings from environment, CORS for the web app, Dockerfile, `docker-compose.yml` for local dev
- [ ] Web: five-round game with a summary screen; Playwright end-to-end test of a full game
- [x] Data: photo catalog loaded from `data/curation/photos.csv` (id, image URL, lat, lon, place, author, license) with validation, replacing the dev fixtures
- [x] Curate the first 50 openly licensed photos (88 curated) into `photos.csv` (Wikimedia Commons, CC BY / CC BY-SA / CC0), outdoor, no people

## Milestone 2 — Atlas v0 and the evaluation harness

- [ ] Eval: metrics module (accuracy at 1/25/200/750/2500 km, median error, mean game score) built on `whereabout_api.geo`, with tests
- [ ] Eval: dataset interface + tiny synthetic fixture + `make eval` CLI that writes a JSON results file
- [ ] Inference service skeleton in `inference/` with a `Predictor` interface and a prior baseline (always guess the most common region) so Atlas can play immediately
- [ ] API: Atlas plays every round through the inference service; the guess response includes Atlas's guess, distance and score
- [ ] Web: reveal animation with Atlas's pin, both arcs and both distances
- [ ] ML: zero-shot CLIP country baseline (open_clip) behind the `Predictor` interface, with a unit test using a stubbed model
- [ ] **[needs you]** Download Im2GPS3k / YFCC4k test sets and run the first real benchmark

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
