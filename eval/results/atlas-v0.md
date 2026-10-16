# Atlas v0 results

Generated 2026-10-16T20:50:43+00:00 by `.github/workflows/atlas.yml` on 238 photos from `data/curation/photos.csv`. Every number below comes from that run; nothing is typed in by hand.

**Playing in the game:** ViT-L-14/openai, country then city (lowest median error).

| System | n | 25 km | 200 km | 750 km | 2,500 km | Median km (95% CI) | Country | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 238 | 0.0% | 0.4% | 2.1% | 10.1% | 7,836 (7,305–8,441) | 1.3% | 328 |
| Best constant guess (baseline) | 238 | 0.4% | 1.3% | 7.1% | 22.7% | 6,151 (5,123–7,038) | 1.3% | 669 |
| ViT-B-32/laion2b_s34b_b79k, country only | 238 | 5.5% | 9.7% | 29.8% | 51.3% | 2,389 (1,792–3,094) | 27.3% | 1,681 |
| ViT-B-32/laion2b_s34b_b79k, country then city | 238 | 6.3% | 13.0% | 30.7% | 53.8% | 2,174 (1,510–2,709) | 26.1% | 1,824 |
| ViT-B-32/openai, country only | 238 | 3.8% | 8.0% | 29.0% | 50.0% | 2,483 (1,777–3,677) | 22.7% | 1,653 |
| ViT-B-32/openai, country then city | 238 | 3.8% | 13.4% | 26.9% | 48.7% | 2,700 (1,905–4,420) | 19.7% | 1,633 |
| ViT-L-14/openai, country only | 238 | 10.5% | 16.0% | 45.8% | 66.8% | 1,006 (695–1,223) | 44.5% | 2,368 |
| ViT-L-14/openai, country then city | 238 | 9.7% | 25.2% | 45.8% | 67.6% | 914 (646–1,290) | 40.8% | 2,489 |

Accuracy columns are the share of photos guessed within that distance. Median error has a 95% bootstrap confidence interval. Mean score uses the game's scoring (5,000 for a perfect guess).

## Is the winner really better?

Paired bootstrap on the same photos: the winner's median error minus each other system's. An interval that excludes 0 is a real difference on photos like these.

| Compared with | Median km difference | 95% CI |
| --- | ---: | ---: |
| Random city (baseline) | -6,922 | -7,527 to -6,346 |
| Best constant guess (baseline) | -5,237 | -6,090 to -4,080 |
| ViT-B-32/laion2b_s34b_b79k, country only | -1,475 | -2,096 to -867 |
| ViT-B-32/laion2b_s34b_b79k, country then city | -1,260 | -1,749 to -638 |
| ViT-B-32/openai, country only | -1,568 | -2,617 to -896 |
| ViT-B-32/openai, country then city | -1,786 | -3,357 to -967 |
| ViT-L-14/openai, country only | -92 | -286 to 204 |

## Where Atlas looked: is the map faithful?

Occlusion saliency on a 7×7 grid over the square CLIP sees, for 238 photos. Deletion test: hide the 5 cells the map ranks highest, or 5 random cells, and measure the relative drop in Atlas's probability for the country it chose.

| Cells hidden | Mean drop in p(country) |
| --- | ---: |
| Top 5 by saliency | 63.1% |
| 5 random (mean of 3 draws) | 31.5% |

Hiding the top cells hurt more than hiding random ones on 90% of photos.

## Read these numbers carefully

- **Small test set.** 238 photos, so intervals are wide.
- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were pre-trained on large web scrapes that probably include Commons images or captions. Some photos may have been seen in training, which would flatter these scores. Public benchmarks (Im2GPS3k, YFCC4k) are the next step.
- **The constant baseline is optimistic.** It is fitted on these same photos.
- **No training happened.** This is zero-shot: the baseline every trained Atlas model has to beat.
