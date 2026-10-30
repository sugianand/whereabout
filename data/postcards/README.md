# Postcards

`postcards.csv` gives catalog photos one thing to learn about their place, for the reveal.
`web/scripts/build-catalog.mjs` folds it into the site's catalog (`web/src/data/photos.json`) as
each photo's `postcard`, keeping only descriptions of at most 240 characters and links to English
Wikipedia, and the reveal shows it under the place name.
It is written by the [Postcards workflow](../../.github/workflows/postcards.yml)
(`whereabout_ml.postcards`), which runs in CI because Commons and Wikipedia cannot be reached
from the development sandbox. Rerun it with `postcards --catalog data/curation/photos.csv --out
data/postcards/postcards.csv`.

| Column | Meaning |
| --- | --- |
| `id` | The catalog photo (`data/curation/photos.csv`) |
| `description` | The English description from the photo's Commons file page, as plain text, at most 240 characters; empty if it has none worth showing |
| `wikipedia_title`, `wikipedia_url` | An English Wikipedia article about what the photo shows; empty if none was found |
| `link_via` | How the article was found: `depicts` or `place` (below) |

## How each part is chosen

- **Description.** The file page's `ImageDescription`. A language-tagged description gives
  its English text only; an untagged one is kept only when it reads as English (one of a few
  common English words). Links, an "English:" label and the heritage contests' template sentence ("This is a photo of
  a monument in … identified by the ID") are removed. Descriptions shorter than
  20 characters, or that only repeat the file name, are dropped. Longer ones end on a whole
  sentence, or on a whole word with an ellipsis.
- **Article, `depicts`.** What the file's structured data says it depicts (Commons MediaInfo,
  P180), preferred statements first. The first Wikidata item with an English Wikipedia article
  *and* a coordinate within 25 km of the camera is used, so general concepts ("sky",
  "mountain") and far-away namesakes are never linked.
- **Article, `place`.** Otherwise each part of the catalog's place name except the country is
  looked up as an English Wikipedia title (redirects followed), and the first article whose
  coordinates lie within 30 km of the camera is used. Disambiguation pages have no coordinates,
  so they never match.

A photo with neither gets no row: nothing is guessed.

## Licence and attribution

- Descriptions are text from Wikimedia Commons file pages, available under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) per the
  [Wikimedia Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use). Each one is
  attributed to its file page, which is the photo's `source_url` in the catalog and is linked
  next to the photo's own credit.
- Wikipedia articles are linked, not copied: only their titles are stored.
- Commons structured data and Wikidata, used only to find the article, are
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
