"""Runtime settings, read once from environment variables.

- `WHEREABOUT_CATALOG`: photo catalog CSV (default: `data/curation/photos.csv` in the repo).
- `WHEREABOUT_ATLAS`: Atlas's precomputed guesses (default: `web/src/data/atlas.json`).
  If the file doesn't exist, rounds are played without Atlas.
- `WHEREABOUT_LABELS`: concept labels the driving-side and climate hints come from (default:
  `data/labels/concept_labels.csv`). If the file doesn't exist, only the continent hint is offered.
- `WHEREABOUT_CORS_ORIGINS`: comma-separated origins allowed to call the API
  (default: `http://localhost:3000`).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CATALOG = REPO_ROOT / "data" / "curation" / "photos.csv"
DEFAULT_ATLAS = REPO_ROOT / "web" / "src" / "data" / "atlas.json"
DEFAULT_LABELS = REPO_ROOT / "data" / "labels" / "concept_labels.csv"


@dataclass(frozen=True, slots=True)
class Settings:
    catalog_path: Path
    cors_origins: tuple[str, ...]
    atlas_path: Path = DEFAULT_ATLAS
    labels_path: Path = DEFAULT_LABELS

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        catalog = Path(env.get("WHEREABOUT_CATALOG", "") or DEFAULT_CATALOG)
        atlas = Path(env.get("WHEREABOUT_ATLAS", "") or DEFAULT_ATLAS)
        labels = Path(env.get("WHEREABOUT_LABELS", "") or DEFAULT_LABELS)
        origins = tuple(
            o.strip()
            for o in env.get("WHEREABOUT_CORS_ORIGINS", "http://localhost:3000").split(",")
            if o.strip()
        )
        return cls(catalog_path=catalog, cors_origins=origins, atlas_path=atlas, labels_path=labels)
