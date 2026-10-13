# Train/validation split

`geo_block_split.csv` (`id,split`, split is `train`, `val` or `buffer`) assigns every photo in
`data/curation/photos.csv` to a side by geography, not at random, so near-duplicates of a place
cannot sit on both sides of the split. Method and rationale: `ml/src/whereabout_ml/split.py`.

Made with the defaults, which are deterministic (no clock, no randomness beyond the seed):

```
geo-split --catalog data/curation/photos.csv --out data/splits/geo_block_split.csv \
  --block-deg 10 --val-frac 0.2 --seed 0 --buffer-km 50
```

(equivalently `python3 -m whereabout_ml.split` with no arguments). The command prints the counts
and the closest train/val pair, and fails if the leakage check does not pass.

- Blocks: 10-degree latitude bands, longitude width widened by 1/cos(latitude), so blocks are
  roughly equal area. Whole blocks go to validation when a SHA-256 hash of `seed:block` falls
  under `val_frac`.
- Buffer: train photos within 50 km (great-circle) of any validation photo are labelled `buffer`
  and should be left out of training.
- Regenerate whenever `photos.csv` changes; the split is stable for photos already in it.

Result on the current catalog: 88 photos, 66 train, 22 val, 0 buffer; the closest train/val
pair is 369.6 km apart.
