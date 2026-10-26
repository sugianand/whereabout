# Reference photos

Geotagged Wikimedia Commons photos that Atlas's retrieval refinement
([`whereabout_ml.retrieval`](../../ml/src/whereabout_ml/retrieval.py)) searches for look-alikes
of a game photo. They are **never game photos**: they only help Atlas place its pin.

`references.csv` is written by [`reference-set`](../../ml/src/whereabout_ml/reference_set.py) in
the [Atlas workflow](../../.github/workflows/atlas.yml) and is not hand-edited. Once it exists,
later runs reuse it as is and only fetch thumbnails still missing, so the set stays the same
from run to run.

| Column | Contents |
| --- | --- |
| `id` | `wr` + Commons page id |
| `title`, `source_url` | The Commons file and its page |
| `lat`, `lon` | Camera location from the file's metadata |
| `country`, `place` | Nearest GeoNames place (`cities15000`) and its country; approximate near borders |
| `author`, `license` | Captured from the Commons API for attribution |
| `thumb_url` | The 330 px thumbnail the model sees |

## How the set is built

1. **Seeds from the gazetteer, not the game.** Up to 3 GeoNames places are drawn at random from
   every 10° grid cell (a different random seed from the harvester's). Game photo locations are
   never used to choose where to search.
2. **Any geotagged photo.** Commons geosearch lists files within 10 km of each seed; up to 8
   JPEGs are drawn at random per seed. Game photos and harvested candidates
   (`data/curation/photos.csv`, `data/harvest/harvested.csv`) are skipped by title.
3. **Same license rules as the game:** CC0, public domain, CC BY or CC BY-SA, an author to
   credit, no personality-rights tag, camera coordinates.
4. **Ordered round-robin by grid cell,** so any prefix of the file covers the map.

The workflow fetches thumbnails for 30 minutes per run and caches them on the runner; the rest
are fetched by follow-up runs.

## Concept labels for the clue heads

`concept_labels.csv` (with a `.meta.json` of counts and sources) gives each reference photo the
labels Atlas's clue heads learn from (`whereabout_ml.clue_heads`): the Köppen-Geiger climate
class and group at its coordinates (Beck et al. 2023, CC BY 4.0) and the driving side of its
GeoNames country. It is written by the [concept labels workflow](../../.github/workflows/labels.yml)
(`concept-labels --references`), never by hand; an empty cell means no label (at sea on the
1 km map, or a territory with no road rule), and such photos are left out of training.

## Leakage guard

Before every Atlas run (`leakage_filter` in `retrieval.py`), references are dropped if they are
the same Commons file as a game photo (a later harvest can merge one), a perceptual-hash
near-duplicate of one, or by the same photographer within 25 km of one of their game photos.
The counts are in `eval/results/atlas-v0.md`. The guard only removes references, so it can make
the refinement's job harder but never flatter its score.

## Attribution

Every reference photo keeps its own author and license in `references.csv`, linked to its
Commons page. Thumbnails stay on the CI runner and are not redistributed in this repository.
Place names and countries: [GeoNames](https://www.geonames.org/) (CC BY 4.0).
