# Whereabout

**Can you beat the AI at guessing where in the world a photo was taken?**

**[▶ Play it now](https://playwhereabout.netlify.app)**

Whereabout is a geography game played against **Atlas**, a computer-vision model. You look at a
photo, drop a pin on a 3D globe, and guess. Then the globe goes full screen: arcs draw from your
pin and Atlas's pin to the true location, the gold pin drops, and the distances count up.

Each visit opens a fresh random game of five photos, avoiding ones you've played recently. The
**Daily Five** (the same photos for everyone each day, so you can compare scores with friends) is
one button away, or at `?daily`. Next to it you can pick **Easy, Medium or Hard**, graded by how far
Atlas actually missed each photo (or open `?tier=hard`), or one continent, so every photo was taken
in, say, South America (`?region=south-america`). The share text gives no spoilers.
**Country Streak** (at `/streak`) asks only for the country: tap it on the globe, one photo after
another, until your first miss. Your best streak stays in your browser.

## What's interesting about it

| Area | What it does | Where |
| --- | --- | --- |
| **Atlas v0** | Hierarchical zero-shot CLIP geolocation: country by prompt-ensembled softmax, then city within the top countries, P(city) = P(country) × P(city \| country), over GeoNames. Clues ("Snow and ice 81%") come from zero-shot concept groups and only show when one option clearly wins. | [`ml/`](ml/) |
| **Clue heads** | Logistic-regression probes on frozen CLIP embeddings read the driving side and the Köppen climate group, trained on reference photos labelled from maps by their coordinates. Each game photo is scored by a probe that never saw its 10° block, against today's source of that clue (the zero-shot climate clue; the driving side of Atlas's guessed country), and a probe writes its clue at the reveal only if a paired bootstrap puts the accuracy gain above zero. | [`ml/src/whereabout_ml/clue_heads.py`](ml/src/whereabout_ml/clue_heads.py) |
| **Where Atlas looked** | Occlusion saliency: grey out each cell of a 7×7 grid over the square CLIP sees and measure how much Atlas's belief in its country falls. A deletion test (hide the top 5 cells vs 5 random ones) checks that the maps are faithful rather than decorative. The heatmap glows in the reveal card. | [`ml/src/whereabout_ml/saliency.py`](ml/src/whereabout_ml/saliency.py) |
| **Pocket Atlas** | *Test Atlas on your own photo* with no server: every country, city and clue prompt is embedded once offline and shipped as int8 vectors (a few MB); CLIP's image encoder runs in the browser via transformers.js; the country-then-city math is a TypeScript port pinned to the Python reference by a shared fixture. A real-Chromium test checks the browser's embedding against PyTorch's before the index ships (it caught four mismatches: an 8-bit browser model, photos read without their EXIF orientation, open_clip running OpenAI's weights without QuickGELU, and a canvas resize that barely antialiased big photos; the browser now computes CLIP's input with a byte-exact port of Pillow's bicubic resample, `preprocess.ts`). A privacy gate runs first: the scene gate's people and indoor checks, recalibrated for the browser's model, decline a photo of people or of a room before Atlas guesses. When you show it where the photo was, the globe shades every country by how sure it was, the same heatmap as the game's reveal (`belief.py` and its port in `belief.ts`). On request, *Where did Atlas look?* runs occlusion saliency in the browser: each of 49 patches is greyed out in CLIP's pixels and re-embedded, and the deletion test (hide the top 5 patches vs. 5 random ones) checks the map on your photo; `saliency.ts` is pinned to `saliency.py` by `data/fixtures/saliency_cases.json`. Your photo never leaves your device. | [`ml/src/whereabout_ml/pocket_index.py`](ml/src/whereabout_ml/pocket_index.py), [`web/src/lib/pocket/`](web/src/lib/pocket/) |
| **Evaluation** | Accuracy at 1 / 25 / 200 / 750 / 2,500 km, median error with bootstrap CIs, a paired bootstrap to test whether one system really beats another, a country-only ablation and two baselines. All scored with the same haversine that scores players. | [`eval/`](eval/), [`eval/results/`](eval/results/) |
| **Cold-path inference** | The model runs once, in GitHub Actions, over the catalog. The game ships its answers, so no visit ever waits on a model and hosting costs nothing. | [`.github/workflows/atlas.yml`](.github/workflows/atlas.yml) |
| **The reveal** | Great-circle arcs that cross the antimeridian correctly, a camera that fits its zoom to the visible frame (each zoom level halves the planet's span) and pads around the result card, reduced-motion support. Below Atlas's reasoning, *the real clues* (driving side, Köppen climate group, ESA WorldCover land cover at the spot) sit next to what Atlas read, each marked right or wrong; land cover is judged only where Atlas's scene clue and the map settle whether the spot is built up. | [`web/src/lib/reveal.ts`](web/src/lib/reveal.ts), [`web/src/lib/trueClues.ts`](web/src/lib/trueClues.ts) |
| **One definition of distance** | The browser and the server score with separate code (TypeScript and Python), so a shared fixture pins them together: both test suites check the same 10 cases. | [`data/fixtures/geo_cases.json`](data/fixtures/geo_cases.json) |
| **Spoiler-free share card** | The summary previews exactly what will be sent: a distance band per round, who got closer to each photo (you or Atlas), the score and hints taken, then the Web Share sheet where the browser has one, else the clipboard. The card is built only from numbers and fixed words, and a test plays every catalog photo through it to check the text never changes with the photos, so it can't leak a place. | [`web/src/lib/share.ts`](web/src/lib/share.ts) |
| **Your record against Atlas** | Games played, rounds won against Atlas, best game and Daily Five streak, kept only in your browser with a confirm-to-reset button. Streaks count Daily Five *puzzle days* (UTC) rather than local dates, so time zones and daylight-saving changes never break one; tests pin that down in Los Angeles, Tokyo and across the October clock change. A stored record is validated on read, and a corrupt one starts over instead of crashing. | [`web/src/lib/playerRecord.ts`](web/src/lib/playerRecord.ts) |
| **Country Streak** | Name the country by tapping it on the same Natural Earth shapes the globe draws: an even-odd point-in-polygon test, with rings that cross the antimeridian (mainland Russia, Fiji) unwrapped first so they don't swallow the rest of the world, and Antarctica closed along the pole. Only photos whose country the globe draws are dealt, so every answer can be tapped. The rules are a pure reducer (a sea tap is no answer, the first miss ends the run); a browser test walks the keyboard pin into the right country twice, then a wrong one. | [`web/src/lib/countryHit.ts`](web/src/lib/countryHit.ts), [`web/src/lib/game/streak.ts`](web/src/lib/game/streak.ts) |
| **Continent games** | Each playable photo's catalog country maps to one of seven continents (the same table the results page groups Atlas's errors by), rebuilt at every build so each harvest grows the pools. A continent is offered only when it can fill a game, in the same menu as the difficulty tiers so a phone's header stays one row; a browser test checks every photo a Europe game fetches was taken in Europe. | [`web/src/lib/game/regions.ts`](web/src/lib/game/regions.ts) |
| **Difficulty from the model's own errors** | Easy, Medium and Hard are the thirds of the catalog by how far Atlas v0's guess landed from each photo, recomputed at every build, so tiers follow each Atlas run and harvest with no hand labelling. The header states each tier's real cut points ("Atlas missed these by … km or more", from the current data); photos Atlas sat out join no tier, and tiers only appear when every third can fill a game. A browser test measures Atlas's errors independently and checks a Hard game deals only Hard photos. | [`web/src/lib/game/tiers.ts`](web/src/lib/game/tiers.ts) |
| **Hints for points** | Up to three clues per round, broadest first: the continent, the side of the road traffic drives on, then the climate group, from concept labels read off real climate and land-cover maps. Each one lowers the round's maximum by 1,000 points. On the API the server hands out the hints and counts them, so a guess can't claim fewer; the static game builds the same clues in the same words, and a shared fixture pins both scorers together. | [`api/src/whereabout_api/hints.py`](api/src/whereabout_api/hints.py), [`web/src/lib/hints.ts`](web/src/lib/hints.ts), [`data/fixtures/hint_cases.json`](data/fixtures/hint_cases.json) |
| **Game engine** | A pure reducer drives the game, with two interchangeable backends: the FastAPI server (answers stay server-side until you guess, and it scores Atlas's guess too) or the static catalog (a free static site that fetches only the five photos each game deals, so the page stays small as the catalog grows). | [`web/src/lib/game/`](web/src/lib/game/) |
| **Accessibility** | The whole game can be played with the keyboard, and an end-to-end test does exactly that. Type is Atkinson Hyperlegible; results are announced to screen readers. | [`web/e2e/`](web/e2e/) |
| **Open data** | 88 photos from 54 countries, all openly licensed from Wikimedia Commons, reviewed by eye, credited after every round. | [`data/curation/`](data/curation/) |

## Atlas results

Zero-shot, on the 88 game photos (run of 2026-10-10, from
[`eval/results/atlas-v0.md`](eval/results/atlas-v0.md), which
[`.github/workflows/atlas.yml`](.github/workflows/atlas.yml) generates and commits):

| System | Within 25 km | Within 750 km | Country right | Median error (95% CI) | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 0.0% | 1.1% | 2.3% | 7,836 km (7,081–8,722) | 268 |
| Best constant guess (baseline) | 1.1% | 3.4% | 2.3% | 6,470 km (4,467–7,355) | 591 |
| CLIP ViT-B/32 (LAION-2B), country then city | 9.1% | 27.3% | 27.3% | 2,593 km (1,633–4,098) | 1,739 |
| CLIP ViT-L/14 (OpenAI), country only | 6.8% | 42.0% | 43.2% | 1,156 km (701–2,823) | 2,149 |
| **CLIP ViT-L/14 (OpenAI), country then city** (plays in the game) | **13.6%** | **43.2%** | 42.0% | **949 km** (649–2,834) | **2,359** |

What the run shows:

- **Model size matters.** ViT-L/14 beats ViT-B/32 by 1,644 km of median error, and a paired
  bootstrap puts that difference clearly away from zero (95% CI −2,773 to −10 km).
- **The city step helps where it should.** It doubles city-level hits (6.8% → 13.6% within
  25 km), but its effect on median error is within noise (−207 km, CI −1,335 to 870).
- **Atlas has a geography.** Computed from the shipped guesses on the site's
  [How Atlas guesses](web/src/app/atlas/page.tsx) page: its median error is 166 km on the
  5 photos from Oceania but 7,075 km on the 8 from South America, where it never names the
  right country. Small groups, but a clear target for a trained Atlas.
- **Caveats.** 88 photos is small, and CLIP was pre-trained on web data that probably includes
  Wikimedia Commons, which may flatter these scores. Public benchmarks are next.

## How it fits together

```
 Browser (Next.js static export)                          GitHub Actions (offline, cold path)
 ┌─────────────────────────────────────────────┐          ┌─────────────────────────────────────┐
 │ Game: photo ─ globe (MapLibre, WebGL)       │          │ atlas.yml                           │
 │   game reducer ── LocalBackend (catalog) ◀──┼──────────┼─ atlas.json: guesses, clues,        │
 │        └──────── ApiBackend ──┐             │          │   "where Atlas looked" maps,        │
 │                               │             │          │   evaluation table                  │
 │ Your photo (Pocket Atlas)     │             │          │ eval/results/: metrics, deletion    │
 │   transformers.js CLIP ──┐    │             │          │   test, browser-vs-PyTorch parity   │
 │   locate.ts ◀────────────┴────┼─────────────┼──────────┼─ pocket-atlas/: int8 text index     │
 └───────────────────────────────┼─────────────┘          └─────────────────────────────────────┘
                                 ▼
                    FastAPI (rounds, server-side scoring of player and Atlas)
```

More in [`docs/architecture.md`](docs/architecture.md), design decisions in
[`docs/decisions/`](docs/decisions/), the visual system in [`docs/design.md`](docs/design.md).

## Run it

```bash
make web-install && make web-dev   # the game on http://localhost:3000
make install && make test          # Python: api, eval, ml
make web-test                      # web: lint, unit tests, build, bundle check, type-check
make web-e2e                       # real games in Chromium (npx playwright install chromium)
make api                           # the FastAPI backend on :8000 (docs at /docs)
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` to play against the API instead of the bundled
catalog, or run both with `docker compose up --build`.

Run Atlas yourself (downloads CLIP weights and the photos):

```bash
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e api -e eval -e "ml[clip]"
atlas-v0 --catalog data/curation/photos.csv --gazetteer data/geonames \
         --images .cache/images --atlas-out web/src/data/atlas.json \
         --results-dir eval/results --model ViT-B-32:laion2b_s34b_b79k
```

Image embeddings are cached per model, photo and image bytes in `.cache/embeddings`, so a rerun
only encodes new photos and its guesses match the first run's exactly. Saliency maps are cached
in `.cache/saliency`; `--saliency-budget-minutes N` stops starting new maps after N minutes (the
CI run uses 90 and queues another run for the photos still without one).

Atlas can also refine its pin by retrieval: within the country it chose, it moves the pin to
where the most similar geotagged reference photos were taken (never game photos; see
[`data/reference/`](data/reference/README.md) and
[decision 0005](docs/decisions/0005-retrieval-refinement.md)). The refined Atlas is scored next
to the others and plays only if a paired bootstrap shows it beats the unrefined one:

```bash
reference-set --gazetteer data/geonames --exclude data/curation/photos.csv \
    --exclude data/harvest/harvested.csv --out data/reference/references.csv \
    --images .cache/references --budget-minutes 30
atlas-v0 ... --references data/reference/references.csv --reference-images .cache/references
```

The same `--references` run also trains a geocell head: a linear classifier over adaptive
geocells on frozen CLIP embeddings of the reference photos, with haversine label smoothing
([decision 0007](docs/decisions/0007-geocell-head.md)). It is scored alone and as the pin within
Atlas's country, and places the pin in the game only if the paired bootstrap says it clearly
beats the playing Atlas. It takes a few minutes on a CPU runner.

With `--pocket-model` as well, a country head for Pocket Atlas is distilled from the playing
Atlas: trained on the browser model's embeddings of the reference photos to match the playing
model's calibrated country probabilities, as a correction to Pocket Atlas's own zero-shot logits
([decision 0008](docs/decisions/0008-distilled-country-head.md)). Its verdict against today's
Pocket Atlas goes to `eval/results/pocket-calibration.json`; `--distill-budget-minutes` caps how
long one run spends embedding the reference photos with the playing model.

Concept labels for the clue heads (driving side, climate, land cover) come from open maps by
coordinates; see [`data/maps/README.md`](data/maps/README.md) for the downloads and
`python -m pip install -e "ml[maps]"` for the GeoTIFF reader. The catalog's labels are made by
[`.github/workflows/labels.yml`](.github/workflows/labels.yml), which fetches the real maps,
checks known places against them and commits [`data/labels/`](data/labels/README.md); locally:

```bash
concept-labels --catalog data/curation/photos.csv --maps-dir data/maps \
    --known-places data/fixtures/concept_places.json \
    --out data/labels/concept_labels.csv --download \
    --references data/reference/references.csv \
    --references-out data/reference/concept_labels.csv
atlas-v0 ... --references data/reference/references.csv \
    --labels data/labels/concept_labels.csv --reference-labels data/reference/concept_labels.csv
```

The second half labels the reference photos too, and `atlas-v0` then fits and scores the clue
heads (`whereabout_ml.clue_heads`, [decision 0006](docs/decisions/0006-clue-heads.md)).

Training images come through an ingestion pipeline that captures each Commons file's license
and author from the Commons API, rejects anything outside CC0 / public domain / CC BY /
CC BY-SA, and flags near-duplicates with a 64-bit perceptual hash.
[`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) runs it on the catalog's files
and commits [`data/ingest/`](data/ingest/README.md); locally (`ml[ingest]`):

```bash
ingest-commons --catalog data/curation/photos.csv --out-dir data/ingest --name sample
```

New game photos come from a harvester that searches Commons around GeoNames places in every
10° grid cell for community-assessed Quality and Featured images, runs them through the same
license and duplicate checks (against the catalog too) and the CLIP scene gate, names each
place from GeoNames and balances the result across the grid.
[`.github/workflows/harvest.yml`](.github/workflows/harvest.yml) runs it and commits
[`data/harvest/`](data/harvest/README.md) with every rejection and its reason, then adds every
new harvested photo to the catalog and starts the Atlas run; the game deals a new photo once
Atlas has guessed it. Locally (`ml[clip,ingest]` and the GeoNames files):

```bash
harvest-commons --gazetteer data/geonames --catalog data/curation/photos.csv \
    --thresholds data/scene_gate/thresholds.json --out-dir data/harvest --target 1000
merge-harvest --catalog data/curation/photos.csv --harvested data/harvest/harvested.csv
cd web && npm run catalog
```

## Tests

Every push runs the Python suites, the web unit tests, a production build, a type-check, a
Docker smoke test of the API, and Playwright games on a desktop and a phone viewport.

## Honest limitations

- Atlas v0 is zero-shot. Its trained parts (the geocell head and the map-derived clue heads)
  are small classifiers on a frozen encoder, and each only plays where it clearly beats v0;
  fine-tuning the encoder needs a GPU.
- The photos come from Wikimedia Commons, which CLIP's web-scale pre-training probably saw.
  Scores on this set may be flattered; public benchmarks are next.
- In the static demo the answers ship in the page and image URLs contain file names. It's a
  casual daily puzzle; leaderboards and rooms will use the API, which keeps answers server-side.

## Roadmap

Day-by-day progress is tracked in [`docs/roadmap.md`](docs/roadmap.md).

## License

Code: MIT, see [LICENSE](LICENSE). Photos keep their own Creative Commons licenses and are
credited in the game and in [`data/curation/photos.csv`](data/curation/photos.csv). Country and
city data: [GeoNames](https://www.geonames.org/) (CC BY 4.0). Coastlines and borders:
[Natural Earth](https://www.naturalearthdata.com/) (public domain).
