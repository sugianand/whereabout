# Whereabout

**Can you beat the AI at guessing where in the world a photo was taken?**

**[▶ Play it now](https://playwhereabout.netlify.app)**

Whereabout is a geography game played against **Atlas**, a computer-vision model. You look at a
photo, drop a pin on a 3D globe, and guess. Then the globe goes full screen: arcs draw from your
pin and Atlas's pin to the true location, the gold pin drops, and the distances count up.

Everyone gets the same **Daily Five** photos each day, so you can compare scores with friends,
and the share text gives no spoilers.

## What's interesting about it

| Area | What it does | Where |
| --- | --- | --- |
| **Atlas v0** | Hierarchical zero-shot CLIP geolocation: country by prompt-ensembled softmax, then city within the top countries, P(city) = P(country) × P(city \| country), over GeoNames. Clues ("Snow and ice 81%") come from zero-shot concept groups and only show when one option clearly wins. | [`ml/`](ml/) |
| **Where Atlas looked** | Occlusion saliency: grey out each cell of a 7×7 grid over the square CLIP sees and measure how much Atlas's belief in its country falls. A deletion test (hide the top 5 cells vs 5 random ones) checks that the maps are faithful rather than decorative. The heatmap glows in the reveal card. | [`ml/src/whereabout_ml/saliency.py`](ml/src/whereabout_ml/saliency.py) |
| **Pocket Atlas** | *Test Atlas on your own photo* with no server: every country, city and clue prompt is embedded once offline and shipped as int8 vectors (a few MB); CLIP's image encoder runs in the browser via transformers.js; the country-then-city math is a TypeScript port pinned to the Python reference by a shared fixture. A real-Chromium test checks the browser's embedding against PyTorch's before the index ships. Your photo never leaves your device. | [`ml/src/whereabout_ml/pocket_index.py`](ml/src/whereabout_ml/pocket_index.py), [`web/src/lib/pocket/`](web/src/lib/pocket/) |
| **Evaluation** | Accuracy at 1 / 25 / 200 / 750 / 2,500 km, median error with bootstrap CIs, a paired bootstrap to test whether one system really beats another, a country-only ablation and two baselines. All scored with the same haversine that scores players. | [`eval/`](eval/), [`eval/results/`](eval/results/) |
| **Cold-path inference** | The model runs once, in GitHub Actions, over the catalog. The game ships its answers, so no visit ever waits on a model and hosting costs nothing. | [`.github/workflows/atlas.yml`](.github/workflows/atlas.yml) |
| **The reveal** | Great-circle arcs that cross the antimeridian correctly, a camera that fits its zoom to the visible frame (each zoom level halves the planet's span) and pads around the result card, reduced-motion support. | [`web/src/lib/reveal.ts`](web/src/lib/reveal.ts) |
| **One definition of distance** | The browser and the server score with separate code (TypeScript and Python), so a shared fixture pins them together: both test suites check the same 10 cases. | [`data/fixtures/geo_cases.json`](data/fixtures/geo_cases.json) |
| **Game engine** | A pure reducer drives the game, with two interchangeable backends: the FastAPI server (answers stay server-side until you guess, and it scores Atlas's guess too) or the bundled catalog (a free static site). | [`web/src/lib/game/`](web/src/lib/game/) |
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
make web-test                      # web: lint, unit tests, build, type-check
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

Concept labels for the clue heads (driving side, climate, land cover) come from open maps by
coordinates; see [`data/maps/README.md`](data/maps/README.md) for the downloads and
`python -m pip install -e "ml[maps]"` for the GeoTIFF reader.

## Tests

Every push runs the Python suites, the web unit tests, a production build, a type-check, a
Docker smoke test of the API, and Playwright games on a desktop and a phone viewport.

## Honest limitations

- Atlas v0 is zero-shot: nothing is trained yet. It is the baseline that trained models
  (geocell classification, retrieval refinement, map-derived clue heads) have to beat.
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
