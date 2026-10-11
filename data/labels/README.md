# Concept labels

`concept_labels.csv` holds one row per photo in `data/curation/photos.csv`, with the concepts
Atlas's clue heads learn from. It is generated, not hand-edited: the
[Concept labels workflow](../../.github/workflows/labels.yml) downloads the real maps, checks
known places against them (`data/fixtures/concept_places.json`) and commits the result.
`concept_labels.meta.json` records how many photos got each label, which WorldCover tiles were
absent (open sea) and which archive file the climate map came from.

| Column | Meaning | Source |
| --- | --- | --- |
| `id` | Photo id in the catalog | `data/curation/photos.csv` |
| `climate` | Köppen-Geiger class, 1991–2020, at the photo's 1 km pixel | Beck et al. (2023), CC BY 4.0 |
| `climate_group` | Tropical, Arid, Temperate, Continental or Polar | derived from `climate` |
| `land_cover` | Most common ESA WorldCover class within 15×15 px (~150 m) | ESA WorldCover 2021 v200, CC BY 4.0 |
| `driving_side` | `left` or `right`, from the photo's curated country | `whereabout_ml.labels` |

An empty cell means "no label" (sea, no data, or no rule for the country); training skips it
rather than guessing. Attribution for the maps is in [`data/maps/README.md`](../maps/README.md):

- Beck, H.E. et al. *High-resolution (1 km) Köppen-Geiger maps for 1901–2099 based on
  constrained CMIP6 projections.* Scientific Data 10, 724 (2023). CC BY 4.0.
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed
  by ESA WorldCover consortium. CC BY 4.0.
