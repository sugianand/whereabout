# Atlas v0 results

Generated 2026-10-25T21:27:11+00:00 by `.github/workflows/atlas.yml` on 388 photos from `data/curation/photos.csv`. Every number below comes from that run; nothing is typed in by hand.

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
| ViT-L-14/openai, country then city, then nearest reference photos | 388 | 5.2% | 16.2% | 37.4% | 66.2% | 1,280 (1,012–1,546) | 38.1% | 2,210 |

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
| ViT-L-14/openai, country then city, then nearest reference photos | -374 | -600 to -187 |

## Where Atlas looked: is the map faithful?

Occlusion saliency on a 7×7 grid over the square CLIP sees, for 388 photos. Deletion test: hide the 5 cells the map ranks highest, or 5 random cells, and measure the relative drop in Atlas's probability for the country it chose.

| Cells hidden | Mean drop in p(country) |
| --- | ---: |
| Top 5 by saliency | 62.8% |
| 5 random (mean of 3 draws) | 31.5% |

Hiding the top cells hurt more than hiding random ones on 92% of photos.

## Retrieval refinement: does it beat the system it refines?

ViT-L-14/openai, country then city refined by searching 4,322 geotagged reference photos in 156 countries (never game photos; image similarity from ViT-B-32/laion2b_s34b_b79k): within Atlas's chosen country, the pin moves to the weighted medoid of the 10 most similar reference photos. It moved the pin on 275 of 388 photos; the others had too few reference photos in their country. References dropped by the leakage guard: 23 same photographer near a game photo.

| Refined minus unrefined | Median km difference | 95% CI | Plays in the game |
| --- | ---: | ---: | --- |
| ViT-L-14/openai, country then city | 374 | 187 to 600 | no |

It plays only if the whole interval is below zero.

## How sure is Atlas: calibration

Temperature scaling of the playing system's country probabilities, on the 388 photos whose country the gazetteer knows. Each photo's temperature is fitted on the other 4 of 5 folds, dealt by 10° geographic blocks, so every calibrated number below is measured on photos its fit never saw. Fitted on all of them, T = 1.030 (above 1 means the raw model was overconfident).

| Probabilities | Negative log likelihood | Expected calibration error |
| --- | ---: | ---: |
| Raw CLIP softmax | 2.366 | 2.3% |
| Temperature-scaled (held out) | 2.378 | 2.9% |

The game shows the raw probabilities: temperature scaling did not lower held-out NLL.

| Atlas said | Photos | Right country |
| --- | ---: | ---: |
| 0% to 10% (mean 7%) | 25 | 8% |
| 10% to 20% (mean 15%) | 54 | 15% |
| 20% to 30% (mean 25%) | 59 | 20% |
| 30% to 40% (mean 35%) | 68 | 35% |
| 40% to 50% (mean 45%) | 45 | 40% |
| 50% to 60% (mean 55%) | 38 | 55% |
| 60% to 70% (mean 65%) | 21 | 67% |
| 70% to 80% (mean 75%) | 35 | 74% |
| 80% to 90% (mean 85%) | 19 | 89% |
| 90% to 100% (mean 94%) | 24 | 88% |

## Read these numbers carefully

- **Small test set.** 388 photos, so intervals are wide.
- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were pre-trained on large web scrapes that probably include Commons images or captions. Some photos may have been seen in training, which would flatter these scores. Public benchmarks (Im2GPS3k, YFCC4k) are the next step.
- **The constant baseline is optimistic.** It is fitted on these same photos.
- **No training happened.** This is zero-shot: the baseline every trained Atlas model has to beat.
