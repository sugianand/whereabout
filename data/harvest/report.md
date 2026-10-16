# Commons harvest

Harvested 504 photos; the catalog would grow from 238 to 742 photos across 138 grid cells (10 degree cells).

## Funnel

| Step | Count |
| --- | ---: |
| Seed places searched | 2148 (in 235 cells) |
| Seeds skipped (search still busy after retries) | 0 |
| Assessed files found (Quality or Featured) | 2650 |
| Already in the catalog | 151 |
| Candidates after the per-cell cap | 1627 |
| Screened by the scene gate | 1106 |
| Passed the scene gate | 595 |
| Passed every check | 595 |
| Harvested after grid balancing | 504 |

## Rejections

| Stage | Reason | Photos |
| --- | --- | ---: |
| metadata | license not allowed | 21 |
| metadata | narrower than 1280 px | 6 |
| metadata | no author to credit | 2 |
| metadata | not a JPEG photo | 2 |
| metadata | not landscape | 474 |
| metadata | personality rights (identifiable people) | 14 |
| ingest | near-duplicate of another candidate | 2 |
| scene_gate | scene gate | 511 |

A photo can reach more than one scene-gate threshold, so the per-reason counts below can add up to more than the photos the gate rejected.

| Scene-gate reason | Threshold (log-odds) | Photos at or above it |
| --- | ---: | ---: |
| people | 6.863 | 132 |
| indoor | 9.154 | 28 |
| text | 2.095 | 171 |
| not_photo | 9.704 | 111 |
| close_up | -0.334 | 360 |

Scene-gate model: ViT-B-32/laion2b_s34b_b79k.
