# Atlas v0 results

Generated 2026-10-13T22:35:17+00:00 by `.github/workflows/atlas.yml` on 88 photos from `data/curation/photos.csv`. Every number below comes from that run; nothing is typed in by hand.

**Playing in the game:** ViT-L-14/openai, country then city (lowest median error).

| System | n | 25 km | 200 km | 750 km | 2,500 km | Median km (95% CI) | Country | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 88 | 0.0% | 0.0% | 1.1% | 8.0% | 7,836 (7,081–8,722) | 2.3% | 268 |
| Best constant guess (baseline) | 88 | 1.1% | 1.1% | 3.4% | 23.9% | 6,470 (4,467–7,355) | 2.3% | 591 |
| ViT-B-32/laion2b_s34b_b79k, country only | 88 | 5.7% | 12.5% | 28.4% | 48.9% | 2,590 (1,833–3,963) | 30.7% | 1,645 |
| ViT-B-32/laion2b_s34b_b79k, country then city | 88 | 9.1% | 20.5% | 27.3% | 48.9% | 2,593 (1,633–4,098) | 27.3% | 1,739 |
| ViT-B-32/openai, country only | 88 | 3.4% | 8.0% | 22.7% | 45.5% | 2,936 (1,777–4,171) | 20.5% | 1,520 |
| ViT-B-32/openai, country then city | 88 | 5.7% | 10.2% | 19.3% | 42.0% | 3,426 (2,047–4,566) | 15.9% | 1,428 |
| ViT-L-14/openai, country only | 88 | 6.8% | 18.2% | 42.0% | 58.0% | 1,156 (701–2,823) | 43.2% | 2,149 |
| ViT-L-14/openai, country then city | 88 | 13.6% | 28.4% | 43.2% | 58.0% | 949 (649–2,834) | 42.0% | 2,359 |

Accuracy columns are the share of photos guessed within that distance. Median error has a 95% bootstrap confidence interval. Mean score uses the game's scoring (5,000 for a perfect guess).

## Is the winner really better?

Paired bootstrap on the same photos: the winner's median error minus each other system's. An interval that excludes 0 is a real difference on photos like these.

| Compared with | Median km difference | 95% CI |
| --- | ---: | ---: |
| Random city (baseline) | -6,887 | -7,749 to -5,006 |
| Best constant guess (baseline) | -5,521 | -6,562 to -2,925 |
| ViT-B-32/laion2b_s34b_b79k, country only | -1,641 | -2,765 to -117 |
| ViT-B-32/laion2b_s34b_b79k, country then city | -1,644 | -2,773 to -10 |
| ViT-B-32/openai, country only | -1,987 | -3,224 to -247 |
| ViT-B-32/openai, country then city | -2,477 | -3,590 to -776 |
| ViT-L-14/openai, country only | -207 | -1,335 to 870 |

## Where Atlas looked: is the map faithful?

Occlusion saliency on a 7×7 grid over the square CLIP sees, for 88 photos. Deletion test: hide the 5 cells the map ranks highest, or 5 random cells, and measure the relative drop in Atlas's probability for the country it chose.

| Cells hidden | Mean drop in p(country) |
| --- | ---: |
| Top 5 by saliency | 59.6% |
| 5 random (mean of 3 draws) | 30.8% |

Hiding the top cells hurt more than hiding random ones on 89% of photos.

## Read these numbers carefully

- **Small test set.** 88 photos, so intervals are wide.
- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were pre-trained on large web scrapes that probably include Commons images or captions. Some photos may have been seen in training, which would flatter these scores. Public benchmarks (Im2GPS3k, YFCC4k) are the next step.
- **The constant baseline is optimistic.** It is fitted on these same photos.
- **No training happened.** This is zero-shot: the baseline every trained Atlas model has to beat.
