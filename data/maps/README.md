# Concept maps

Raster maps that turn a photo's coordinates into training labels for Atlas v1's clue heads
(`ml/src/whereabout_ml/maps.py`). The maps are large, so they are not committed. Download them
into this directory (it is listed in `.gitignore`) and install the reader with
`python -m pip install -e "ml[maps]"`.

| Concept | Map | Resolution | License | Expected path |
| --- | --- | --- | --- | --- |
| `climate` | Köppen-Geiger classification, Beck et al. | 1 km (0.0083°) | CC BY 4.0 | `data/maps/koppen_geiger_0p00833333.tif` |
| `land_cover` | ESA WorldCover 2021 v200 | 10 m, 3°×3° tiles | CC BY 4.0 | `data/maps/worldcover/ESA_WorldCover_10m_2021_v200_<N51E000>_Map.tif` |

Both are GeoTIFFs in latitude/longitude (EPSG:4326). The reader only opens the small window
around each photo, so the full 1 km climate map never has to fit in memory, and only the
WorldCover tiles that contain photos need to be downloaded. A missing tile gives no label.

## Legends

- **Köppen-Geiger**: codes 1–30 in the order Af, Am, Aw, BWh, BWk, BSh, BSk, Csa, Csb, Csc,
  Cwa, Cwb, Cwc, Cfa, Cfb, Cfc, Dsa, Dsb, Dsc, Dsd, Dwa, Dwb, Dwc, Dwd, Dfa, Dfb, Dfc, Dfd, ET,
  EF; 0 is sea. Check this against the `legend.txt` that ships with the download before
  training. `koppen_group()` folds the classes into Tropical, Arid, Temperate, Continental and
  Polar.
- **WorldCover**: 10 Tree cover, 20 Shrubland, 30 Grassland, 40 Cropland, 50 Built-up,
  60 Bare / sparse vegetation, 70 Snow and ice, 80 Permanent water bodies, 90 Herbaceous
  wetland, 95 Mangroves, 100 Moss and lichen; 0 is no data. A photo's land cover is the most
  common class within 15×15 pixels (about 150 m), because the pixel under the photographer is
  usually a road or a viewpoint rather than what the photo shows.

## Sources and attribution

- Beck, H.E., McVicar, T.R., Vergopolan, N. et al. *High-resolution (1 km) Köppen-Geiger maps
  for 1901–2099 based on constrained CMIP6 projections.* Scientific Data 10, 724 (2023).
  Earlier version: Beck, H.E. et al. *Present and future Köppen-Geiger climate classification
  maps at 1-km resolution.* Scientific Data 5, 180214 (2018). Both are distributed under
  CC BY 4.0 via https://www.gloh2o.org/koppen/.
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed
  by ESA WorldCover consortium. CC BY 4.0. Tiles: https://esa-worldcover.org (public bucket
  `s3://esa-worldcover/v200/2021/map/`).
