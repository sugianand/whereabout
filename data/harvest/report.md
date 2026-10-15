# Commons harvest

Harvested 307 photos; the catalog would grow from 88 to 395 photos across 118 grid cells (10 degree cells).

## Funnel

| Step | Count |
| --- | ---: |
| Seed places searched | 820 (in 235 cells) |
| Seeds skipped (search still busy after retries) | 0 |
| Assessed files found (Quality or Featured) | 1046 |
| Already in the catalog | 0 |
| Candidates after the per-cell cap | 564 |
| Screened by the scene gate | 402 |
| Passed the scene gate | 307 |
| Passed every check | 307 |
| Harvested after grid balancing | 307 |

## Rejections

| Stage | Reason | Photos |
| --- | --- | ---: |
| metadata | license not allowed | 5 |
| metadata | narrower than 1280 px | 2 |
| metadata | not landscape | 148 |
| metadata | personality rights (identifiable people) | 6 |
| ingest | near-duplicate of another candidate | 1 |
| scene_gate | scene gate | 95 |

A photo can reach more than one scene-gate threshold, so the per-reason counts below can add up to more than the photos the gate rejected.

| Scene-gate reason | Threshold (log-odds) | Photos at or above it |
| --- | ---: | ---: |
| people | 6.863 | 35 |
| indoor | 9.154 | 7 |
| text | 2.095 | 41 |
| not_photo | 9.704 | 42 |

Scene-gate model: ViT-B-32/laion2b_s34b_b79k.
