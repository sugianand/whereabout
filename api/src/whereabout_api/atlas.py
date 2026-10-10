"""Atlas's precomputed guesses (web/src/data/atlas.json, written by .github/workflows/atlas.yml).

Atlas runs offline over the catalog; the API only looks its answer up and scores it with the same
distance and points functions it uses for players, so a head-to-head is decided in one place.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from whereabout_api.geo import LatLon


class AtlasFileError(ValueError):
    """Raised when atlas.json exists but is malformed. The message names the photo."""


@dataclass(frozen=True, slots=True)
class AtlasClue:
    label: str
    p: float


@dataclass(frozen=True, slots=True)
class AtlasGuess:
    location: LatLon
    confidence: float
    guessed_place: str | None
    top_countries: tuple[tuple[str, float], ...]
    clues: tuple[AtlasClue, ...]


def _probability(value: Any, where: str) -> float:
    if not isinstance(value, int | float) or isinstance(value, bool) or not 0 <= value <= 1:
        raise AtlasFileError(f"{where}: expected a probability in [0, 1], got {value!r}")
    return float(value)


def parse_guess(photo_id: str, raw: Mapping[str, Any]) -> AtlasGuess:
    where = f"guess for {photo_id!r}"
    try:
        location = LatLon(float(raw["lat"]), float(raw["lng"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise AtlasFileError(f"{where}: bad location ({exc})") from None

    top = tuple(
        (str(c["country"]), _probability(c["p"], f"{where} top country"))
        for c in raw.get("topCountries", [])
    )
    clues = tuple(
        AtlasClue(str(c["label"]), _probability(c["p"], f"{where} clue"))
        for c in raw.get("clues", [])
    )
    place = raw.get("guessedPlace")
    return AtlasGuess(
        location=location,
        confidence=_probability(raw.get("confidence", 0), f"{where} confidence"),
        guessed_place=str(place) if place else None,
        top_countries=top,
        clues=clues,
    )


def load_atlas(path: Path) -> dict[str, AtlasGuess]:
    """Atlas's guesses by photo id. A missing file means Atlas hasn't run yet: no guesses."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AtlasFileError(f"{path}: not valid JSON ({exc})") from None
    guesses = data.get("guesses") if isinstance(data, dict) else None
    if not isinstance(guesses, dict):
        raise AtlasFileError(f"{path}: expected an object with a 'guesses' object")
    return {pid: parse_guess(pid, g) for pid, g in guesses.items()}
