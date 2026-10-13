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
- [x] ML: "where Atlas looked" occlusion saliency with a deletion-test faithfulness check, shown in the reveal (docs/decisions/0003)
- [x] Web + ML: Pocket Atlas, "test Atlas on your own photo" entirely in the browser, with a browser-vs-PyTorch parity test (docs/decisions/0004)
- [ ] **[needs you]** Download Im2GPS3k / YFCC4k test sets and run the first public benchmark

## Milestone 2.5 — Fresh games, a bigger world, visibly AI

Priority from the project owner (2026-10-13): a visit should never open on the same photos,
the catalog should grow to about 1,000 photos screened by AI rather than by eye, and the site
should show the model at work. These steps come before the rest of Milestone 3.

- [x] Web: every visit opens a fresh random five-photo game; the Daily Five moves behind a button, with tests for both modes
- [x] ML: AI scene gate, CLIP zero-shot screening for people, indoor scenes, text that gives away the place and non-photos, with thresholds checked against the 88 hand-reviewed photos and a small labelled reject fixture (`ml/src/whereabout_ml/scene_gate.py`)
- [ ] ML: make the gate's indoor and not-a-photo reasons useful: the first calibration run (`data/scene_gate/report.md`) capped both thresholds at 1.0 because catalog photos scored near 1 (indoor: wm077; not-a-photo: wm126), so neither caught its labelled rejects; try better prompts or a calibrated small false-reject budget, and review those catalog photos
- [ ] Data: Commons harvester in CI, geotagged quality images across landscape and street categories, grid-balanced, run through `ingest.py` (license capture, dedupe against the catalog) and the scene gate, place and country from the GeoNames gazetteer; grow `photos.csv` to about 1,000 and record pass/reject counts per reason
- [ ] CI + Web: Atlas runs on the larger catalog within runner limits; the site loads photos and Atlas's guesses in chunks so the bundle stays small
- [ ] Web: "Atlas's thinking" at the reveal, a probability heatmap over the globe and Atlas's top five countries with confidences (atlas.json carries the distribution)
- [ ] Web: "How Atlas works" gets an AI-curation section with the gate's real pass/reject counts and example rejects
- [x] Web: Pocket Atlas on the home page, "Try Atlas on your photo" (CLIP in the browser) as a first-screen card in the game header, one line on phones so the photo stays the hero
- [ ] ML: retrieval refinement, kNN over CLIP embeddings of geotagged reference photos (harvested, never game photos), compared with Atlas v0 by the paired bootstrap in `eval/`; ships only if it wins

## Milestone 3 — Data pipeline

- [x] Geocells: adaptive cell builder with tests (cells split until each has enough images; a lat/lon quadtree in the spirit of S2, `ml/src/whereabout_ml/geocells.py`)
- [x] Labels: concept-label derivation from coordinates — driving side by country, with tests (`ml/src/whereabout_ml/labels.py`)
- [x] Labels: climate-zone and land-cover lookups from raster maps behind one interface, with tests on known coordinates (`ml/src/whereabout_ml/maps.py`, sources in `data/maps/README.md`)
- [x] Labels: in CI, download the Köppen-Geiger map and the WorldCover tiles the catalog needs, check known places against the real maps, and commit the catalog's concept labels (`.github/workflows/labels.yml`, `data/labels/`)
- [x] Data: ingestion pipeline for image metadata (license capture, perceptual-hash dedupe) on a small sample (`ml/src/whereabout_ml/ingest.py`, `.github/workflows/ingest.yml`, `data/ingest/`)
- [x] Data: geographic-block train/validation split with a leakage test (`ml/src/whereabout_ml/split.py`, output in `data/splits/`)
- [ ] **[needs you]** Pull 1–5M openly licensed training images (OSV-5M / MP-16) to storage

## Milestone 4 and beyond

See `docs/architecture.md` and the design doc: trained geocell classifier with distance-aware
loss, clue heads, retrieval refinement, calibration, privacy gate, Daily Five, rooms,
distillation, deployment, research write-up. New daily-sized steps get added here as each
milestone starts.

## Waiting on you

(The daily job lists blocked steps here with what it needs.)

- **Short site address on Vercel.** Sign in at vercel.com with GitHub, *Add New → Project*,
  import `sugianand/whereabout`, set **Root Directory** to `web` and leave the rest as detected
  (the static export needs no base path there). Name the project `whereabout`, or add a free
  `*.vercel.app` name under *Settings → Domains* if that one is taken, then share
  the address so the README can link to it. GitHub Pages stays on as a mirror.
