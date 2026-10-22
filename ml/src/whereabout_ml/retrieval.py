"""Retrieval refinement: move Atlas's pin to where the most similar reference photos were taken.

Atlas v0 knows countries and cities only through text prompts, so within the right country its
pin lands on a big city even when the photo shows a mountain pass 300 km away. Retrieval asks a
different question: which geotagged photos look most like this one? Image-geolocation systems
from Im2GPS to PIGEON refine a classifier's guess this way.

1. Keep Atlas v0's country. Only reference photos taken in that country are searched, so a
   wrong look-alike abroad cannot drag the pin across a border.
2. Take the `k` reference photos whose CLIP image embeddings are most similar to the photo's.
3. Pin the guess on the neighbour with the smallest similarity-weighted distance to the other
   neighbours (a weighted geographic medoid): where the look-alikes agree, not one outlier.

With fewer than `min_references` reference photos in the country, the v0 guess stands.

The reference photos are never game photos (`whereabout_ml.reference_set` excludes them by
title, and `leakage_filter` drops near-duplicates and same-photographer shots near a game photo
before every run). `k`, `temperature` and `min_references` are fixed defaults, not tuned on the
game photos the refinement is evaluated on.

Whether the refinement plays in the game is decided by `ships`: a paired bootstrap on the same
photos must put its whole 95% interval for the change in median error below zero.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from whereabout_eval.metrics import paired_median_delta_ci
from whereabout_ml.geocells import haversine_matrix
from whereabout_ml.ingest import hamming
from whereabout_ml.zeroshot import Guess, normalise

DEFAULT_K = 10
DEFAULT_TEMPERATURE = 0.05  # cosine-similarity gap that shrinks a neighbour's weight by e
DEFAULT_MIN_REFERENCES = 3
# Leakage guards (see `leakage_filter`).
NEAR_DUPLICATE_BITS = 8  # the same pHash distance `ingest` treats as a duplicate
SAME_AUTHOR_KM = 25.0


@dataclass(frozen=True, slots=True)
class Reference:
    """One geotagged reference photo (a row of data/reference/references.csv)."""

    id: str
    lat: float
    lon: float
    country: str
    place: str
    author: str
    source_url: str


def load_references(path: Path) -> list[Reference]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            Reference(
                id=row["id"],
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                country=row["country"].upper(),
                place=row["place"],
                author=row["author"],
                source_url=row["source_url"],
            )
            for row in csv.DictReader(fh)
        ]


@dataclass(frozen=True, slots=True)
class GamePhotoTrace:
    """What the leakage guard needs to know about one game photo."""

    lat: float
    lon: float
    author: str
    source_url: str
    phash: int | None


def _same_person(a: str, b: str) -> bool:
    a, b = " ".join(a.casefold().split()), " ".join(b.casefold().split())
    return bool(a) and a == b


def leakage_filter(
    references: Sequence[Reference],
    reference_hashes: Sequence[int | None],
    game_photos: Sequence[GamePhotoTrace],
    *,
    max_bits: int = NEAR_DUPLICATE_BITS,
    same_author_km: float = SAME_AUTHOR_KM,
) -> tuple[list[int], Counter[str]]:
    """Indices of the references safe to search, and how many were dropped for each reason.

    A reference must not be a game photo in disguise. Dropped:
    - the same Commons file as a game photo (a harvest can merge a former reference later);
    - a near-duplicate of a game photo by perceptual hash (another upload or crop of it);
    - a photo by the same photographer within `same_author_km` of one of their game photos
      (a burst from the same spot can differ by more than a pHash notices).

    The last guard looks at the answers, but only ever removes references, so it can only make
    the refinement's job harder, never flatter its score.
    """
    if len(references) != len(reference_hashes):
        raise ValueError("references and reference_hashes must have the same length")
    dropped: Counter[str] = Counter()
    sources = {g.source_url for g in game_photos if g.source_url}
    hashes = [g.phash for g in game_photos if g.phash is not None]
    authored = [g for g in game_photos if g.author.strip()]
    near_author: set[int] = set()
    if authored and references:
        d = haversine_matrix(
            [r.lat for r in references],
            [r.lon for r in references],
            [g.lat for g in authored],
            [g.lon for g in authored],
        )
        for i, r in enumerate(references):
            for j in np.flatnonzero(d[i] <= same_author_km):
                if _same_person(r.author, authored[j].author):
                    near_author.add(i)
                    break
    kept: list[int] = []
    for i, (r, h) in enumerate(zip(references, reference_hashes, strict=True)):
        if r.source_url in sources:
            dropped["same file as a game photo"] += 1
        elif h is not None and any(hamming(h, g) <= max_bits for g in hashes):
            dropped["near-duplicate of a game photo"] += 1
        elif i in near_author:
            dropped["same photographer near a game photo"] += 1
        else:
            kept.append(i)
    return kept, dropped


class ReferenceIndex:
    """Reference photos with their image embeddings, searchable within one country."""

    def __init__(
        self,
        references: Sequence[Reference],
        embeddings: np.ndarray,
        *,
        k: int = DEFAULT_K,
        temperature: float = DEFAULT_TEMPERATURE,
        min_references: int = DEFAULT_MIN_REFERENCES,
    ) -> None:
        embeddings = np.asarray(embeddings, dtype=np.float64)
        if embeddings.ndim != 2 or embeddings.shape[0] != len(references):
            raise ValueError(
                f"need one embedding row per reference, got {embeddings.shape} "
                f"for {len(references)} references"
            )
        if k < 1 or min_references < 1 or temperature <= 0:
            raise ValueError("k and min_references must be at least 1, temperature above 0")
        self.references = list(references)
        self.embeddings = normalise(embeddings) if len(references) else embeddings
        self.k, self.temperature, self.min_references = k, temperature, min_references
        by_country: dict[str, list[int]] = defaultdict(list)
        for i, r in enumerate(self.references):
            by_country[r.country].append(i)
        self._by_country = {c: np.array(ix) for c, ix in by_country.items()}

    def __len__(self) -> int:
        return len(self.references)

    def in_country(self, country: str) -> int:
        ix = self._by_country.get(country.upper())
        return 0 if ix is None else len(ix)

    def neighbours(self, query: np.ndarray, country: str) -> list[tuple[Reference, float]]:
        """The `k` most similar references in `country`, most similar first, with cosine
        similarity. Empty when the country has fewer than `min_references`."""
        ix = self._by_country.get(country.upper())
        if ix is None or len(ix) < self.min_references:
            return []
        q = normalise(np.asarray(query, dtype=np.float64))
        sims = self.embeddings[ix] @ q
        # Stable sort, so equal similarities keep the references' file order.
        top = np.argsort(-sims, kind="stable")[: self.k]
        return [(self.references[ix[t]], float(sims[t])) for t in top]

    def refine(self, query: np.ndarray, guess: Guess) -> tuple[Guess, bool]:
        """`guess` moved to the weighted medoid of its look-alikes, and whether it moved.

        Country, confidence, shortlist and clues stay Atlas v0's; the pin and the place name
        come from the chosen reference photo.
        """
        found = self.neighbours(query, guess.country)
        if not found:
            return guess, False
        refs = [r for r, _ in found]
        sims = np.array([s for _, s in found])
        weights = np.exp((sims - sims.max()) / self.temperature)
        lat = [r.lat for r in refs]
        lon = [r.lon for r in refs]
        cost = haversine_matrix(lat, lon, lat, lon) @ weights
        best = refs[int(np.argmin(cost))]  # ties go to the more similar neighbour
        return replace(guess, lat=best.lat, lon=best.lon, city=best.place), True


@dataclass(frozen=True, slots=True)
class Verdict:
    """The paired comparison that decides whether the refinement plays in the game."""

    ships: bool
    median_km_delta: float
    ci95: tuple[float, float]


def ships(refined_km: Sequence[float], base_km: Sequence[float]) -> Verdict:
    """Refined minus base median error on the same photos, with a paired-bootstrap 95% CI.

    The refinement ships only if the whole interval is below zero: better on photos like these,
    not just on the photos that happened to be drawn.
    """
    delta, lo, hi = paired_median_delta_ci(list(refined_km), list(base_km))
    return Verdict(ships=hi < 0 and delta < 0, median_km_delta=delta, ci95=(lo, hi))


def summary(
    verdict: Verdict,
    *,
    versus: str,
    references: int,
    countries: int,
    moved: int,
    n: int,
    dropped: Mapping[str, int],
    model: str,
    k: int = DEFAULT_K,
) -> dict:
    """The record of a refinement run that atlas.json and eval/results carry."""
    return {
        "versus": versus,
        "model": model,
        "references": references,
        "countries": countries,
        "moved": moved,
        "n": n,
        "dropped": dict(sorted(dropped.items())),
        "k": k,
        "median_km_delta": round(verdict.median_km_delta, 1),
        "ci95": [round(x, 1) for x in verdict.ci95],
        "ships": verdict.ships,
    }
