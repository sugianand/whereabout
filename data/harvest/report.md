# Commons harvest

Harvested 645 photos; the catalog would grow from 88 to 733 photos across 138 grid cells (10 degree cells).

## Funnel

| Step | Count |
| --- | ---: |
| Seed places searched | 2148 (in 235 cells) |
| Seeds skipped (search still busy after retries) | 0 |
| Assessed files found (Quality or Featured) | 2650 |
| Already in the catalog | 1 |
| Candidates after the per-cell cap | 1720 |
| Screened by the scene gate | 1209 |
| Passed the scene gate | 716 |
| Passed every check | 716 |
| Harvested after grid balancing | 645 |

## Rejections

| Stage | Reason | Photos |
| --- | --- | ---: |
| metadata | license not allowed | 21 |
| metadata | narrower than 1280 px | 6 |
| metadata | no author to credit | 3 |
| metadata | no camera coordinates | 2 |
| metadata | not a JPEG photo | 2 |
| metadata | not landscape | 461 |
| metadata | personality rights (identifiable people) | 14 |
| ingest | near-duplicate of another candidate | 2 |
| scene_gate | scene gate | 493 |

A photo can reach more than one scene-gate threshold, so the per-reason counts below can add up to more than the photos the gate rejected.

| Scene-gate reason | Threshold (log-odds) | Photos at or above it |
| --- | ---: | ---: |
| people | 6.863 | 127 |
| indoor | 9.154 | 28 |
| text | 2.095 | 164 |
| not_photo | 9.704 | 107 |
| close_up | -0.334 | 345 |

Scene-gate model: ViT-B-32/laion2b_s34b_b79k.
