# Whereabout

**Can you beat the AI at guessing where in the world a photo was taken?**

Whereabout is a geography game played against **Atlas**, a computer-vision model that reads a
photo the way expert players do. You look at a photo, drop a pin on the globe, and then watch
Atlas drop its own pin, show the clues it noticed, and measure who got closer.

> Status: early development (Milestone 1 — playable shell). Nothing here is deployed yet.

## How it works (short version)

1. **Look** — a photo appears.
2. **Pin** — you guess a location on the globe.
3. **Reveal** — Atlas guesses too, explains its clues, and both distances are scored.

Under the hood (planned, see [`docs/architecture.md`](docs/architecture.md)):

- a fine-tuned vision transformer that classifies photos into geographic cells,
- retrieval over a reference index of geotagged images to refine the guess,
- interpretable "clue" heads (driving side, climate, land cover) trained on labels derived from open maps,
- a privacy gate: region-level answers only, photos with people declined, EXIF stripped.

## Repository layout

| Path | What lives there |
| --- | --- |
| `api/` | FastAPI backend: rounds, guesses, scoring |
| `web/` | Next.js frontend (coming in Milestone 1) |
| `ml/` | Training code for Atlas (Milestone 4) |
| `eval/` | Evaluation harness and benchmarks (Milestone 2) |
| `docs/` | Architecture, decisions, research notes |

## Run the API locally

```bash
python -m pip install -e "api[dev]"
make test        # run the test suite
make api         # start the API on http://localhost:8000 (docs at /docs)
```

## Roadmap

| Milestone | Goal |
| --- | --- |
| 1 | Playable shell: globe, pins, scoring, curated photos |
| 2 | Atlas v0: zero-shot baseline + evaluation harness |
| 3 | Data pipeline: openly licensed geotagged images, concept labels |
| 4 | Atlas v1: trained geocell classifier + clue heads |
| 5 | Retrieval refinement, heatmaps, calibrated confidence |
| 6 | Privacy gate and "Your Photo" mode |
| 7 | Daily Five, friend rooms, share cards |
| 8 | Distillation and CPU serving optimization |
| 9 | Production hardening and observability |
| 10 | Research write-up and launch |

## Results

No model results yet. Every number that appears here will be produced by the evaluation
harness in `eval/` and traceable to a committed run.

## License

MIT — see [LICENSE](LICENSE). Photos used in the game will carry their own licenses and attribution.
