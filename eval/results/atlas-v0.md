# Atlas v0 results

Generated 2026-10-28T17:48:49+00:00 by `.github/workflows/atlas.yml` on 388 photos from `data/curation/photos.csv`. Every number below comes from that run; nothing is typed in by hand.

**Playing in the game:** ViT-L-14/openai, country then city (lowest median error).

| System | n | 25 km | 200 km | 750 km | 2,500 km | Median km (95% CI) | Country | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 388 | 0.3% | 0.8% | 2.3% | 11.3% | 7,744 (7,207–8,262) | 1.5% | 350 |
| Best constant guess (baseline) | 388 | 2.3% | 2.8% | 7.2% | 22.2% | 6,529 (6,105–7,205) | 9.5% | 654 |
| ViT-B-32/laion2b_s34b_b79k, country only | 388 | 4.6% | 10.3% | 28.4% | 50.3% | 2,422 (1,911–3,163) | 26.5% | 1,677 |
| ViT-B-32/laion2b_s34b_b79k, country then city | 388 | 5.7% | 11.6% | 29.9% | 53.6% | 2,139 (1,561–2,604) | 25.5% | 1,814 |
| ViT-B-32/openai, country only | 388 | 3.1% | 7.0% | 25.8% | 44.6% | 2,900 (2,520–3,928) | 20.4% | 1,539 |
| ViT-B-32/openai, country then city | 388 | 4.9% | 12.1% | 27.1% | 45.6% | 2,961 (2,481–4,448) | 17.0% | 1,572 |
| ViT-L-14/openai, country only | 388 | 9.5% | 18.8% | 45.1% | 68.0% | 896 (746–1,080) | 46.9% | 2,457 |
| ViT-L-14/openai, country then city | 388 | 11.6% | 26.8% | 50.0% | 68.3% | 758 (517–973) | 44.1% | 2,621 |
| ViT-L-14/openai, country then city, then nearest reference photos | 388 | 6.4% | 18.8% | 42.3% | 68.6% | 1,021 (827–1,331) | 44.1% | 2,393 |
| ViT-B-32/laion2b_s34b_b79k geocell head, alone | 388 | 0.0% | 2.6% | 21.4% | 53.1% | 2,402 (1,911–2,659) | 23.7% | 1,502 |
| ViT-L-14/openai, country then city, then geocell head | 388 | 2.3% | 18.0% | 46.9% | 69.8% | 857 (670–1,174) | 44.1% | 2,444 |
| ViT-B-32/openai, country then city, then nearest reference photos (Pocket Atlas) | 388 | 2.6% | 8.2% | 23.2% | 44.6% | 3,237 (2,550–4,301) | 17.0% | 1,440 |
| ViT-B-32/openai, country then city, distilled country head (Pocket Atlas) | 388 | 5.4% | 10.3% | 25.8% | 48.2% | 2,795 (2,215–3,843) | 19.1% | 1,568 |

Accuracy columns are the share of photos guessed within that distance. Median error has a 95% bootstrap confidence interval. Mean score uses the game's scoring (5,000 for a perfect guess).

## Is the winner really better?

Paired bootstrap on the same photos: the winner's median error minus each other system's. An interval that excludes 0 is a real difference on photos like these.

| Compared with | Median km difference | 95% CI |
| --- | ---: | ---: |
| Random city (baseline) | -6,986 | -7,533 to -6,407 |
| Best constant guess (baseline) | -5,771 | -6,478 to -5,234 |
| ViT-B-32/laion2b_s34b_b79k, country only | -1,664 | -2,248 to -1,236 |
| ViT-B-32/laion2b_s34b_b79k, country then city | -1,381 | -1,827 to -896 |
| ViT-B-32/openai, country only | -2,142 | -3,195 to -1,721 |
| ViT-B-32/openai, country then city | -2,203 | -3,579 to -1,758 |
| ViT-L-14/openai, country only | -138 | -330 to 18 |
| ViT-L-14/openai, country then city, then nearest reference photos | -263 | -462 to -108 |
| ViT-B-32/laion2b_s34b_b79k geocell head, alone | -1,644 | -1,915 to -1,176 |
| ViT-L-14/openai, country then city, then geocell head | -98 | -287 to 12 |
| ViT-B-32/openai, country then city, then nearest reference photos (Pocket Atlas) | -2,479 | -3,522 to -1,844 |
| ViT-B-32/openai, country then city, distilled country head (Pocket Atlas) | -2,037 | -3,115 to -1,454 |

## Where Atlas looked: is the map faithful?

Occlusion saliency on a 7×7 grid over the square CLIP sees, for 388 photos. Deletion test: hide the 5 cells the map ranks highest, or 5 random cells, and measure the relative drop in Atlas's probability for the country it chose.

| Cells hidden | Mean drop in p(country) |
| --- | ---: |
| Top 5 by saliency | 58.1% |
| 5 random (mean of 3 draws) | 24.6% |

Hiding the top cells hurt more than hiding random ones on 94% of photos.

## Retrieval refinement: does it beat the system it refines?

ViT-L-14/openai, country then city refined by searching 4,322 geotagged reference photos in 156 countries (never game photos; image similarity from ViT-B-32/laion2b_s34b_b79k): within Atlas's chosen country, the pin moves to the weighted medoid of the 10 most similar reference photos. It moved the pin on 284 of 388 photos; the others had too few reference photos in their country. References dropped by the leakage guard: 23 same photographer near a game photo.

| Refined minus unrefined | Median km difference | 95% CI | Plays in the game |
| --- | ---: | ---: | --- |
| ViT-L-14/openai, country then city | 263 | 108 to 462 | no |

It plays only if the whole interval is below zero.

## Pocket Atlas: would retrieval help the browser's model?

"Try Atlas on your photo" runs ViT-B-32/openai in the browser. The same reference photos, embedded by that model, refine its own guesses (ViT-B-32/openai, country then city) as above: the pin moves to the weighted medoid of the 10 most similar reference photos within its chosen country. It moved the pin on 215 of 388 catalog photos.

| Refined minus unrefined | Median km difference | 95% CI | Turns on in the browser |
| --- | ---: | ---: | --- |
| ViT-B-32/openai, country then city | 276 | -150 to 512 | no |

It may turn on only if the whole interval is below zero. The game's own Atlas is never changed by this row.

## Geocell head: does a trained classifier place the pin better?

A linear classifier over 93 adaptive geocells, on frozen ViT-B-32/laion2b_s34b_b79k image embeddings of 4,322 reference photos (never game photos), trained with haversine label smoothing (τ = 300 km, L2 = 0.01, both chosen by 10° geographic cross-validation over the reference photos alone). The pin is the candidate with the least expected distance under the head's cell probabilities. Scored alone (any cell, in the table above) and within ViT-L-14/openai, country then city's country, where it moved the pin on 284 of 388 photos.

| Within the country, minus without | Median km difference | 95% CI | Plays in the game |
| --- | ---: | ---: | --- |
| ViT-L-14/openai, country then city | 98 | -12 to 287 | no |

It plays only if the whole interval is below zero.

## How sure is Atlas: calibration

Temperature scaling of the playing system's country probabilities, on the 388 photos whose country the gazetteer knows. Each photo's temperature is fitted on the other 4 of 5 folds, dealt by 10° geographic blocks, so every calibrated number below is measured on photos its fit never saw. Fitted on all of them, T = 1.170 (above 1 means the raw model was overconfident).

| Probabilities | Negative log likelihood | Expected calibration error |
| --- | ---: | ---: |
| Raw CLIP softmax | 2.065 | 8.2% |
| Temperature-scaled (held out) | 2.043 | 3.8% |

The game shows the temperature-scaled probabilities, because they lowered held-out NLL.

| Atlas said | Photos | Right country |
| --- | ---: | ---: |
| 0% to 10% (mean 7%) | 11 | 0% |
| 10% to 20% (mean 15%) | 37 | 11% |
| 20% to 30% (mean 25%) | 61 | 25% |
| 30% to 40% (mean 35%) | 62 | 32% |
| 40% to 50% (mean 45%) | 49 | 41% |
| 50% to 60% (mean 55%) | 40 | 57% |
| 60% to 70% (mean 64%) | 38 | 74% |
| 70% to 80% (mean 74%) | 28 | 75% |
| 80% to 90% (mean 85%) | 40 | 80% |
| 90% to 100% (mean 94%) | 22 | 86% |

## Clue heads: do trained probes read the scene better than today's clues?

Logistic-regression probes on frozen CLIP image embeddings (ViT-B-32/laion2b_s34b_b79k), fitted on 4,306 reference photos labelled by their coordinates (Köppen-Geiger climate group, driving side of the country). Each game photo is predicted by a probe that never saw a reference photo from its 10° geographic block, and scored against the game photo's own map label. A probe writes its clue at the reveal only if the paired 95% interval of the accuracy difference is above zero.

| Concept | Photos | Probe | Compared with | Their accuracy | Commonest class | Difference (95% CI) | Writes the clue |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| driving side | 387 | 79.8% | the driving side of the country Atlas guessed | 80.6% | 73.1% | -0.8% (-5.9% to +4.4%) | no |
| climate group | 351 | 63.0% | the zero-shot climate clue | 45.3% | 33.6% | +17.7% (+10.8% to +24.5%) | yes |

## Pocket Atlas: do clue heads read your photo better?

The same probes, fitted on 4,306 reference photos embedded by the browser's model (ViT-B-32/openai), scored the same way against what "Try Atlas on your photo" shows today: its zero-shot climate clue, and the driving side of the country it guessed. A probe that clearly wins ships in the browser's index and writes that clue for players' own photos. The game's Atlas is never changed by these rows.

| Concept | Photos | Probe | Compared with | Their accuracy | Difference (95% CI) | Runs in the browser |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| driving side | 387 | 79.3% | the driving side of the country Atlas guessed | 69.8% | +9.6% (+4.7% to +14.7%) | yes |
| climate group | 351 | 62.4% | the zero-shot climate clue | 46.2% | +16.2% (+10.0% to +22.8%) | yes |

## Pocket Atlas: does a head taught by the game's Atlas name countries better?

A country head on the browser's model (ViT-B-32/openai), trained on 4,322 reference photos to match the calibrated country probabilities of the game's Atlas (ViT-L-14/openai, country then city, T = 1.1703). It is a correction added to Pocket Atlas's own zero-shot logits, with L2 = 0.01 chosen by 10° geographic cross-validation over the reference photos alone. Each catalog photo is scored by a head that never saw a reference photo from its block, against today's Pocket Atlas (ViT-B-32/openai, country then city); it changed the top country on 204 of 388 photos.

| Country probabilities | Photos | Negative log likelihood | Right country | In the top 5 |
| --- | ---: | ---: | ---: | ---: |
| Pocket Atlas today (zero-shot) | 388 | 3.337 | 20.4% | 50.3% |
| Distilled head (held out) | 388 | 3.294 | 22.7% | 46.7% |
| The game's Atlas, for context | 388 | 2.032 | 46.9% | |

| Distilled minus today | Difference | 95% CI |
| --- | ---: | ---: |
| Negative log likelihood | -0.043 | -0.113 to +0.031 |
| Right country | +2.3% | -1.0% to +5.9% |
| Median pin error (km) | -166 | -1,209 to +458 |

It may run in the browser only if the whole likelihood interval is below zero, the right-country rate does not drop and the pin is not clearly further away: **it does not**. The game's own Atlas is never changed by these rows.

## Read these numbers carefully

- **Small test set.** 388 photos, so intervals are wide.
- **Possible leakage.** The photos come from Wikimedia Commons, and CLIP models were pre-trained on large web scrapes that probably include Commons images or captions. Some photos may have been seen in training, which would flatter these scores. Public benchmarks (Im2GPS3k, YFCC4k) are the next step.
- **The constant baseline is optimistic.** It is fitted on these same photos.
- **Little training.** Atlas v0 is zero-shot. The clue heads, the geocell head and Pocket Atlas's distilled country head are small classifiers fitted on frozen embeddings of the reference photos, and each plays only where it clearly beats what it would replace.
