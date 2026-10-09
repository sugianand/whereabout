# Photo catalog

`photos.csv` holds the photos players see. Every row is an openly licensed, geotagged image
from Wikimedia Commons, credited to its author.

| Column | Meaning |
| --- | --- |
| `id` | Stable id (`wm` + source index) |
| `image_url` | 1280 px rendition served by Wikimedia |
| `lat`, `lon` | Camera location from the file's Commons coordinates |
| `place` | Human-readable place shown at the reveal |
| `country` | ISO 3166-1 alpha-2 code |
| `author`, `license`, `source_url` | Attribution, shown after each round |

## How the first 88 photos were chosen (2026-10-09)

1. Queried the Commons API for featured and quality images in landscape, street, road,
   building, coast, mountain and bridge categories, keeping only geotagged files under
   CC BY, CC BY-SA, CC0 or public domain, in landscape orientation (1,692 candidates).
2. Balanced geography: grouped candidates into 12° latitude/longitude cells and kept at most
   two per cell (159 photos), so Europe doesn't dominate the game.
3. Reviewed every photo by eye on contact sheets and removed:
   - photos where people are prominent or identifiable (privacy),
   - indoor scenes, wildlife and macro close-ups (nothing to locate),
   - signs that spell out the answer,
   - near-duplicates of places already in the set,
   - two files whose Commons coordinates contradict their own titles.
4. Wrote a place name and country for each of the 88 remaining photos, from the file title
   and coordinates.

The result spans 54 countries and every inhabited continent. `api/tests/test_catalog.py`
fails the build if a row loses its license, attribution or valid coordinates.

## Known limitation

Wikimedia image URLs contain the original file name, which often names the place. A
determined player can read it in the browser's network tab. Proxying images through the API
under opaque ids fixes this and is on the roadmap.
