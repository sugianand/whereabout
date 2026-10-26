"""A trained geocell head: Atlas learns where photos were taken from geotagged examples.

Atlas v0 places its pin from text alone ("a photo taken in Cusco, Peru"), so inside the right
country it lands on a big city. A geocell head learns the map from pictures instead
(docs/architecture.md, "Atlas v1", in the style of PlaNet and PIGEON), small enough to fit on
the CPU runner:

- **Classes are geocells** (`whereabout_ml.geocells`): an adaptive quadtree over the reference
  photos (`data/reference/`, geotagged Commons files that are never game photos), so dense
  regions get small cells.
- **A linear classifier on frozen CLIP embeddings** (the retrieval model's space, where the
  reference photos are already embedded), trained with *haversine label smoothing*
  (`geocells.soft_targets`): a photo's target spreads over the cells near it, so guessing the
  next cell is cheaper than guessing another continent.
- **The pin minimises expected distance.** Given the head's cell probabilities p, the pin is the
  candidate point x minimising Σᵢ pᵢ·d(cᵢ, x), not the single likeliest cell: when the head is
  torn between two neighbouring cells it pins between them rather than gambling on one.
- **Two systems.** *Alone*, the head picks among every cell, for the honest standalone number.
  *Within Atlas's country*, Atlas v0 keeps its country (and so its confidence, shortlist and
  heatmap) and the head only places the pin among the places in that country its cells cover:
  each candidate is the spherical mean of one cell's reference photos taken in that country.
- **Fitted without looking at game photos.** The penalty and the smoothing distance are chosen
  by geographic cross-validation over the reference photos alone (10° blocks: held-out
  references are never next to a training one), by held-out median error. The head is then
  fitted on every reference photo that passed the leakage guard (`retrieval.leakage_filter`)
  and scored once on the game photos.
- **Plays only if it wins.** "Within Atlas's country" replaces the playing pin only if a paired
  bootstrap puts the whole 95% interval of the change in median error below zero
  (`retrieval.ships`, the same rule the retrieval refinement plays by).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_ml.calibration import DEFAULT_BLOCK_DEG, DEFAULT_FOLDS, geo_folds
from whereabout_ml.clue_heads import FIT_ITERATIONS, Probe, fit_soft_probe
from whereabout_ml.geocells import Geocells, haversine_matrix, soft_targets, spherical_mean
from whereabout_ml.retrieval import Reference, Verdict, ships
from whereabout_ml.zeroshot import Guess, normalise

# Quadtree sizes for a few thousand reference photos: a cell splits above MAX_CELL_POINTS and a
# leaf needs MIN_CELL_POINTS photos to be a class. Read at call time, so tests can shrink them.
MAX_CELL_POINTS = 100
MIN_CELL_POINTS = 10
MIN_REFERENCES = 200  # fewer labelled references than this and the head is not fitted
# Tried by geographic cross-validation over the reference photos.
L2_GRID = (1e-3, 1e-2, 1e-1)
TAU_GRID_KM = (100.0, 300.0)
# A country needs this many reference photos for the in-country pin to move (as retrieval).
MIN_COUNTRY_REFERENCES = 3


@dataclass(frozen=True, slots=True)
class Place:
    """A candidate pin: where a cell's reference photos (in one country) were taken."""

    at: LatLon
    country: str
    name: str  # the place name of the reference photo nearest `at`


@dataclass(frozen=True)
class GeocellHead:
    cells: Geocells
    probe: Probe
    tau_km: float
    centres: tuple[Place, ...]  # per cell: its centroid, named after the nearest reference
    # Per country: (cell index, the place its references there average to) for every cell
    # holding a reference photo from that country.
    by_country: dict[str, tuple[tuple[int, Place], ...]]
    country_counts: dict[str, int]
    _cell_km: np.ndarray  # cell centroid × cell centroid distances

    def probabilities(self, x: np.ndarray) -> np.ndarray:
        return self.probe.probabilities(normalise(np.asarray(x, dtype=np.float64)))

    def pin_anywhere(self, p: np.ndarray) -> Place:
        """The cell centroid with the least expected distance under the cell probabilities."""
        return self.centres[int(np.argmin(self._cell_km @ p))]

    def pin_within(self, p: np.ndarray, country: str) -> Place | None:
        """The same rule, over the places in `country` the cells cover; None if too few."""
        options = self.by_country.get(country, ())
        if self.country_counts.get(country, 0) < MIN_COUNTRY_REFERENCES or not options:
            return None
        cells = np.array([i for i, _ in options])
        places = [pl for _, pl in options]
        w = p[cells]
        if w.sum() <= 0:
            return None
        lat = [pl.at.lat for pl in places]
        lon = [pl.at.lon for pl in places]
        cost = haversine_matrix(lat, lon, lat, lon) @ (w / w.sum())
        return places[int(np.argmin(cost))]


def _named(at: LatLon, refs: Sequence[Reference]) -> Place:
    d = haversine_matrix([at.lat], [at.lon], [r.lat for r in refs], [r.lon for r in refs])[0]
    nearest = refs[int(np.argmin(d))]
    return Place(at, nearest.country, nearest.place)


def fit_head(
    references: Sequence[Reference],
    embeddings: np.ndarray,
    *,
    l2: float,
    tau_km: float,
    cells: Geocells | None = None,
    iterations: int = FIT_ITERATIONS,
) -> GeocellHead:
    """Cells over `references` (unless given) and a classifier fitted on all of them."""
    points = [LatLon(r.lat, r.lon) for r in references]
    cells = cells or Geocells.build(points, max_points=MAX_CELL_POINTS, min_points=MIN_CELL_POINTS)
    x = normalise(np.asarray(embeddings, dtype=np.float64))
    keys = tuple(c.key for c in cells.cells)
    probe = fit_soft_probe(x, soft_targets(cells, points, tau_km), keys, l2, iterations=iterations)
    assigned = cells.assign(points)
    members: dict[int, list[Reference]] = defaultdict(list)
    for r, i in zip(references, assigned, strict=True):
        members[int(i)].append(r)
    centres = tuple(
        _named(c.centroid, members.get(i) or list(references)) for i, c in enumerate(cells.cells)
    )
    by_country: dict[str, list[tuple[int, Place]]] = defaultdict(list)
    for i, refs in sorted(members.items()):
        grouped: dict[str, list[Reference]] = defaultdict(list)
        for r in refs:
            grouped[r.country].append(r)
        for country, rs in grouped.items():
            at = spherical_mean(np.array([r.lat for r in rs]), np.array([r.lon for r in rs]))
            by_country[country].append((i, _named(at, rs)))
    counts: dict[str, int] = defaultdict(int)
    for r in references:
        counts[r.country] += 1
    clat, clon = cells.centroids
    return GeocellHead(
        cells,
        probe,
        tau_km,
        centres,
        {c: tuple(v) for c, v in by_country.items()},
        dict(counts),
        haversine_matrix(clat, clon, clat, clon),
    )


def select_hyperparameters(
    references: Sequence[Reference],
    embeddings: np.ndarray,
    cells: Geocells,
    *,
    l2_grid: Sequence[float] = L2_GRID,
    tau_grid_km: Sequence[float] = TAU_GRID_KM,
    folds: int = DEFAULT_FOLDS,
    block_deg: float = DEFAULT_BLOCK_DEG,
    seed: int = 0,
    iterations: int = FIT_ITERATIONS,
) -> tuple[float, float]:
    """(l2, τ km) with the lowest held-out median error over geographic folds of the
    references: the cells stay fixed, and each fold's head is fitted on the other folds."""
    points = [LatLon(r.lat, r.lon) for r in references]
    fold = geo_folds(points, folds, block_deg, seed)
    x = np.asarray(embeddings, dtype=np.float64)
    best, best_km = (l2_grid[0], tau_grid_km[0]), np.inf
    for tau in tau_grid_km:
        for l2 in l2_grid:
            errors = []
            for f in np.unique(fold):
                train = np.flatnonzero(fold != f)
                test = np.flatnonzero(fold == f)
                if len(train) == 0 or len(test) == 0:
                    continue
                head = fit_head(
                    [references[i] for i in train],
                    x[train],
                    l2=l2,
                    tau_km=tau,
                    cells=cells,
                    iterations=iterations,
                )
                for i, p in zip(test, head.probabilities(x[test]), strict=True):
                    at = head.pin_anywhere(p).at
                    errors.append(
                        haversine_matrix([at.lat], [at.lon], [points[i].lat], [points[i].lon])[0, 0]
                    )
            if errors and (km := float(np.median(errors))) < best_km:
                best, best_km = (l2, tau), km
    return best


@dataclass(frozen=True)
class HeadRun:
    """What the run measured: both systems' pins, and whether the in-country one plays."""

    head: GeocellHead
    alone: list[Place]
    within: list[Guess]
    moved: int
    verdict: Verdict


def run_head(
    references: Sequence[Reference],
    reference_embeddings: np.ndarray,
    game_embeddings: np.ndarray,
    guesses: Sequence[Guess],
    playing_km: Sequence[float],
    truth: Sequence[LatLon],
    *,
    iterations: int = FIT_ITERATIONS,
) -> HeadRun | None:
    """Fit the head on the references, pin every game photo both ways, and decide.

    `guesses` and `playing_km` are the playing system's guesses and errors on the same photos.
    None when there are fewer than `MIN_REFERENCES` references or too few for two cells.
    """
    if len(references) < MIN_REFERENCES:
        return None
    if not (len(game_embeddings) == len(guesses) == len(playing_km) == len(truth)):
        raise ValueError("one guess, error and true location per game embedding")
    points = [LatLon(r.lat, r.lon) for r in references]
    try:
        cells = Geocells.build(points, max_points=MAX_CELL_POINTS, min_points=MIN_CELL_POINTS)
    except ValueError:
        return None
    if len(cells) < 2:
        return None
    l2, tau = select_hyperparameters(references, reference_embeddings, cells, iterations=iterations)
    head = fit_head(
        references, reference_embeddings, l2=l2, tau_km=tau, cells=cells, iterations=iterations
    )
    probs = head.probabilities(game_embeddings)
    alone = [head.pin_anywhere(p) for p in probs]
    within: list[Guess] = []
    moved = 0
    for g, p in zip(guesses, probs, strict=True):
        place = head.pin_within(p, g.country)
        if place is None:
            within.append(g)
            continue
        moved += 1
        within.append(replace(g, lat=place.at.lat, lon=place.at.lon, city=place.name))
    km = [
        float(haversine_matrix([g.lat], [g.lon], [t.lat], [t.lon])[0, 0])
        for g, t in zip(within, truth, strict=True)
    ]
    return HeadRun(head, alone, within, moved, ships(km, playing_km))


def summary(run: HeadRun, *, versus: str, model: str, n: int) -> dict:
    """The record atlas.json and eval/results carry."""
    v = run.verdict
    return {
        "versus": versus,
        "model": model,
        "references": int(sum(run.head.country_counts.values())),
        "cells": len(run.head.cells),
        "l2": run.head.probe.l2,
        "tauKm": run.head.tau_km,
        "moved": run.moved,
        "n": n,
        "median_km_delta": round(v.median_km_delta, 1),
        "ci95": [round(x, 1) for x in v.ci95],
        "ships": v.ships,
    }
