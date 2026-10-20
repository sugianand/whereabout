# Atlas v0 results

Generated 2026-10-20T17:43:01+00:00 by `.github/workflows/atlas.yml` on 388 photos from `data/curation/photos.csv`. Every number below comes from that run; nothing is typed in by hand.

**Playing in the game:** ViT-L-14/openai, country then city (lowest median error).

| System | n | 25 km | 200 km | 750 km | 2,500 km | Median km (95% CI) | Country | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 388 | 0.3% | 0.8% | 2.3% | 11.3% | 7,744 (7,207–8,262) | 1.5% | 350 |
| Best constant guess (baseline) | 388 | 2.3% | 2.8% | 7.2% | 22.2% | 6,529 (6,105–7,205) | 9.5% | 654 |
| ViT-B-32/laion2b_s34b_b79k, country only | 388 | 4.6% | 10.3% | 28.4% | 50.3% | 2,422 (1,911–3,163) | 26.5% | 1,677 |
| ViT-B-32/laion2b_s34b_b79k, country then city | 388 | 5.7% | 11.6% | 29.9% | 53.6% | 2,139 (1,561–2,604) | 25.5% | 1,814 |
| ViT-B-32/openai, country only | 388 | 3.1% | 6.7% | 25.0% | 45.9% | 2,997 (2,290–4,106) | 19.8% | 1,502 |
| ViT-B-32/openai, country then city | 388 | 3.6% | 10.3% | 23.2% | 43.3% | 3,998 (2,721–4,884) | 15.7% | 1,427 |
| ViT-L-14/openai, country only | 388 | 8.2% | 15.5% | 43.6% | 67.0% | 972 (778–1,120) | 42.0% | 2,360 |
| ViT-L-14/openai, country then city | 388 | 11.9% | 24.2% | 46.1% | 67.5% | 906 (707–1,178) | 38.1% | 2,487 |

Accuracy columns are the share of photos guessed within that distance. Median error has a 95% bootstrap confidence interval. Mean score uses the game's scoring (5,000 for a perfect guess).

## Is the winner really better?

Paired bootstrap on the same photos: the winner's median error minus each other system's. An interval that excludes 0 is a real difference on photos like these.

| Compared with | Median km difference | 95% CI |
| --- | ---: | ---: |
| Random city (baseline) | -6,837 | -7,358 to -6,243 |
| Best constant guess (baseline) | -5,623 | -6,333 to -5,085 |
| ViT-B-32/laion2b_s34b_b79k, country only | -1,516 | -2,128 to -1,078 |
| ViT-B-32/laion2b_s34b_b79k, country then city | -1,232 | -1,645 to -733 |
| ViT-B-32/openai, country only | -2,091 | -3,182 to -1,470 |
| ViT-B-32/openai, country then city | -3,092 | -3,945 to -1,886 |
| ViT-L-14/openai, country only | -66 | -223 to 118 |

## Where Atlas looked: is the map faithful?

Occlusion saliency on a 7×7 grid over the square CLIP sees, for 388 photos. Deletion test: hide the 5 cells the map ranks highest, or 5 random cells, and measure the relative drop in Atlas's probability for the country it chose.

| Cells hidden | Mean drop in p(country) |
| --- | ---: |
| Top 5 by saliency | 62.8% |
| 5 random (mean of 3 draws) | 31.5% |

Hiding the top cells hurt more than hiding random ones on 92% of photos.

## Read these numbers carefully

- **Small test set.** 388 photos, so intervals are wide.
- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were pre-trained on large web scrapes that probably include Commons images or captions. Some photos may have been seen in training, which would flatter these scores. Public benchmarks (Im2GPS3k, YFCC4k) are the next step.
- **The constant baseline is optimistic.** It is fitted on these same photos.
- **No training happened.** This is zero-shot: the baseline every trained Atlas model has to beat.
