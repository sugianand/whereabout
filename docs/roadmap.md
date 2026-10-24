# Build roadmap

One box is roughly one day of work and one to three commits. The daily build job takes the
first unchecked step that is not marked **[needs you]**, builds it with tests, ticks the box
and pushes. Steps marked **[needs you]** require a GPU, a large dataset download, an account
or a judgment call, so the job skips them and leaves a note under "Waiting on you" instead.

Rules for every step: tests pass, lint passes, small conventional commits, and no invented
numbers anywhere. Benchmark results only appear when produced by `eval/` from a real run.

**Every commit must change the game for players** (project owner, 2026-10-16): it either adds a
layer players can use (a mode, a control, a screen, more photos) or fixes a problem players hit
while playing, proven by a test that fails without it. Roadmap edits, docs and refactors ride
along inside that commit; they never go in a commit of their own. The commit message says what a
player now sees or can do. Before picking a roadmap step, play a full game on a phone and a
desktop viewport (the Playwright suite) and fix what is broken first.

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
- [x] ML: make the gate's indoor and not-a-photo reasons useful: the first calibration run (`data/scene_gate/report.md`) capped both thresholds at 1.0 because catalog photos scored near 1 (indoor: wm077; not-a-photo: wm126), so neither caught its labelled rejects. Cause: probability scores saturate near 1 and thresholds were rounded to three decimals. Scores and thresholds are now log-odds, and the report lists the catalog photos closest to each threshold for review (`data/scene_gate/README.md`); the `scene_gate.yml` run on push recalibrates and commits the new counts
- [x] Data: Commons harvester in CI: Quality and Featured images found by geosearch around GeoNames places in every 10° cell, grid-balanced, run through `ingest.py` (license capture, dedupe against the catalog) and the scene gate, place and country from the GeoNames gazetteer, pass/reject counts per reason (`ml/src/whereabout_ml/harvest.py`, `.github/workflows/harvest.yml`, output in `data/harvest/`)
- [x] Data: widen the harvest and grow the catalog from it: the first run (`data/harvest/report.md` at the time: 1,046 assessed files near 820 seeds, 307 harvested) showed discovery was the bottleneck, so the defaults are now 12 seeds and 30 candidates per cell, and seeds, candidates, per-cell cap, target and merge limit are workflow inputs. Its photos included many birds, insects and flowers, so the scene gate gained a `close_up` reason (nothing to locate) with its own fixture rows, calibrated, like every reason, on the hand-reviewed `wm` photos only. The harvest workflow now appends up to 150 harvested photos per run to `photos.csv` in grid-balancing order (`ml/src/whereabout_ml/merge_harvest.py`), rebuilds `photos.json` and starts the quality, labels and Atlas workflows; the Scene gate workflow starts the harvest when its thresholds change. The game and the API deal only photos Atlas has guessed (`web/src/lib/game/playable.ts`), so new photos appear once the Atlas run covers them
- [x] CI: Atlas runs on the larger catalog within runner limits: image embeddings are cached per model, photo and image bytes (`ml/src/whereabout_ml/embedding_cache.py`), so each run only encodes new photos and reused guesses equal fresh ones; new saliency maps get a 90-minute budget per run and the workflow queues another run for photos still without a map (their guesses ship meanwhile); the 150-photo merge limit is lifted, so a whole harvest joins the game at once
- [x] Web: the site loads photos and Atlas's guesses in chunks so the bundle stays small: the home page ships only the playable ids and a content-hash version, the build writes one record per photo (`out/game-data/<version>/<id>.json`, from `web/src/app/game-data/[version]/[file]/route.ts`) and a game fetches the five it deals (`web/src/lib/game/deck.ts`); `npm run check-bundle` in CI fails if catalog data reaches the home page's scripts again
- [x] Web + ML: "Atlas's thinking" at the reveal, part one: Atlas's shortlist of likeliest countries with confidences, the right one marked (`atlas-v0` reports five; the city step still searches three)
- [x] Web + ML: "Atlas's thinking", part two: a probability heatmap over the globe at the reveal; each guess in atlas.json carries `belief` (every country at p >= 0.005, 3 decimals; `belief_from_probabilities` in `ml/src/whereabout_ml/run_atlas_v0.py`, passed through by `api/src/whereabout_api/atlas.py`) and the globe shades those countries in the Atlas colour under the borders (`web/src/lib/belief.ts`, `web/src/lib/countryIds.ts`, `web/src/components/Globe.tsx`); it appears once the CI Atlas run regenerates `atlas.json`
- [x] Web: "How Atlas works" gets an AI-curation section with the gate's real pass/reject counts and example rejects ("Choosing the photos", from `web/src/data/scene_gate.json`, rebuilt by `scene_gate.yml`)
- [x] Web: Pocket Atlas on the home page, "Try Atlas on your photo" (CLIP in the browser) as a first-screen card in the game header, one line on phones so the photo stays the hero
- [x] ML: retrieval refinement, kNN over CLIP embeddings of geotagged reference photos (harvested, never game photos), compared with Atlas v0 by the paired bootstrap in `eval/`; ships only if it wins. Within Atlas's country the pin moves to the weighted medoid of the 10 most similar reference photos (`ml/src/whereabout_ml/retrieval.py`); references are any licensed geotagged Commons JPEGs near GeoNames seeds, never game or harvested photos, with a leakage guard (`ml/src/whereabout_ml/reference_set.py`, `data/reference/`); the Atlas workflow collects them, scores the refined system in the results table and lets it play only if the paired 95% interval is below zero (docs/decisions/0005); "How Atlas guesses" says which. Its first result appears after the CI run

## Milestone 2.6 — Game layers

Priority from the project owner (2026-10-14): the game opens straight into round one, then grows
layers that give players reasons to come back. Everything here runs in the static site with no
accounts; anything stored about a player stays in their browser.

- [x] Web: first screen is round one: a blurred placeholder holds the photo's place while it loads (no spinner, no splash), and first-time visitors get a small card over the photo, "Guess where this was taken. Atlas, our AI, is guessing too. Beat it.", dismissed by their first tap on the photo or globe and never shown again (browser storage in try/catch, so the game works without it); an end-to-end test that the photo is the first thing on screen and the card does not come back (`web/src/lib/intro.ts`, `placeholderUrl` in `web/src/lib/photoSources.ts`, `web/e2e/game.spec.ts`)
- [x] Web + API: hints for points: up to three clues per round, each lowering the round's maximum score (5,000, then 4,000, 3,000, 2,000): continent, then driving side, then climate group, from `data/labels/concept_labels.csv` bundled at build (`scripts/build-catalog.mjs` joins them into `photos.json`; `labels.yml` rebuilds it). The API hands out hints (`POST /api/v1/rounds/{id}/hints`), counts them and scores the guess server-side; the guess request's `hints_used` must match its count. Both sides build the same clues and scores, checked against `data/fixtures/hint_cases.json` (`api/src/whereabout_api/hints.py`, `web/src/lib/hints.ts`, e2e test on desktop and phone)
- [ ] Web: Daily Five share card: a spoiler-free result (a distance band per round and whether you beat Atlas, no photos or place names) copied to the clipboard or sent with the Web Share API, with tests that nothing in it gives a location away
- [ ] Web: your record against Atlas: games played, rounds won against Atlas, best game and Daily Five streak, kept only in this browser, shown on the summary screen with a reset button, with tests for streaks across days and time zones
- [ ] Web: difficulty tiers: Easy, Medium and Hard games picked by how far Atlas v0 actually missed each photo (thirds of the real errors in `atlas.json`, labelled "how hard it was for Atlas"), chosen next to the Daily Five; tests that tiers come from the data and every tier can fill a five-photo game
- [ ] Web: Country Streak: name the country by tapping it on the globe, one photo after another until the first miss; best streak kept in the browser; tests for the country hit test and the streak rules
- [x] Web: on phones the reveal keeps the answer in view: the result card shows the place, both distances and the verdict, Atlas's reasoning folds behind "How Atlas guessed", the camera frames the arcs between the header and the card, and the map credits no longer run over the round progress (e2e test plays five rounds on a phone viewport)
- [ ] **[needs you]** Rooms: friends play the same five photos live and see each other's pins at the reveal; needs a hosted API with Redis (`docs/architecture.md`) and a choice of host

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

- **Look at two catalog photos by eye.** They set the scene gate's bars (`data/scene_gate/report.md`,
  "closest to each threshold"): `wm077` (St Olof's church ruin, Sigtuna) is the only keeper near the
  indoor bar, and `wm126` (El Gouna, Egypt) is the top keeper for people, not-a-photo and second for
  text. If either is really a reject, drop it from `data/curation/photos.csv` and the gate tightens
  on its own when CI recalibrates. (The daily job cannot open Commons images from its sandbox.)

- **Short site address on Vercel.** Sign in at vercel.com with GitHub, *Add New → Project*,
  import `sugianand/whereabout`, set **Root Directory** to `web` and leave the rest as detected
  (the static export needs no base path there). Name the project `whereabout`, or add a free
  `*.vercel.app` name under *Settings → Domains* if that one is taken, then share
  the address so the README can link to it. GitHub Pages stays on as a mirror.
