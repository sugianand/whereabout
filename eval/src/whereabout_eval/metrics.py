"""Geolocation metrics.

Distances use `whereabout_api.geo.haversine_km`, the same function that scores players, so a
model's benchmark numbers and its in-game performance are measured identically.

Reported metrics follow the image-geolocation literature: the share of predictions within
1 / 25 / 200 / 750 / 2,500 km (street / city / region / country / continent), plus median
error. The mean game score is included because it is what players experience.
"""

from __future__ import annotations

import math
import random
import statistics
from collections.abc import Sequence
from dataclasses import dataclass, field

from whereabout_api.geo import ACCURACY_THRESHOLDS_KM, LatLon, haversine_km, score_distance


@dataclass(frozen=True, slots=True)
class Prediction:
    item_id: str
    predicted: LatLon
    truth: LatLon
    predicted_country: str | None = None
    true_country: str | None = None

    @property
    def distance_km(self) -> float:
        return haversine_km(self.predicted, self.truth)


@dataclass(frozen=True, slots=True)
class Report:
    n: int
    accuracy_at_km: dict[float, float]
    median_km: float
    mean_km: float
    mean_score: float
    country_accuracy: float | None
    median_km_ci95: tuple[float, float] | None = field(default=None)

    def as_dict(self) -> dict:
        return {
            "n": self.n,
            "accuracy_at_km": {str(int(k)): round(v, 4) for k, v in self.accuracy_at_km.items()},
            "median_km": round(self.median_km, 1),
            "mean_km": round(self.mean_km, 1),
            "mean_score": round(self.mean_score, 1),
            "country_accuracy": None
            if self.country_accuracy is None
            else round(self.country_accuracy, 4),
            "median_km_ci95": None
            if self.median_km_ci95 is None
            else [round(x, 1) for x in self.median_km_ci95],
        }


def bootstrap_median_ci(
    distances: Sequence[float], *, resamples: int = 2000, seed: int = 0
) -> tuple[float, float]:
    """95% bootstrap confidence interval for the median distance."""
    if not distances:
        raise ValueError("no distances")
    rng = random.Random(seed)
    n = len(distances)
    medians = sorted(statistics.median(rng.choices(distances, k=n)) for _ in range(resamples))
    lo = medians[int(0.025 * (resamples - 1))]
    hi = medians[int(math.ceil(0.975 * (resamples - 1)))]
    return lo, hi


def evaluate(predictions: Sequence[Prediction], *, bootstrap: bool = True) -> Report:
    if not predictions:
        raise ValueError("no predictions to evaluate")
    distances = [p.distance_km for p in predictions]
    n = len(distances)

    with_country = [p for p in predictions if p.predicted_country and p.true_country]
    country_accuracy = (
        sum(p.predicted_country == p.true_country for p in with_country) / len(with_country)
        if with_country
        else None
    )

    return Report(
        n=n,
        accuracy_at_km={t: sum(d <= t for d in distances) / n for t in ACCURACY_THRESHOLDS_KM},
        median_km=statistics.median(distances),
        mean_km=statistics.fmean(distances),
        mean_score=statistics.fmean(score_distance(d) for d in distances),
        country_accuracy=country_accuracy,
        median_km_ci95=bootstrap_median_ci(distances) if bootstrap and n > 1 else None,
    )


def markdown_table(reports: dict[str, Report]) -> str:
    """One row per system, for READMEs and research notes."""
    head = (
        "| System | n | 25 km | 200 km | 750 km | 2,500 km | Median km (95% CI) | "
        "Country | Mean score |"
    )
    sep = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    rows = []
    for name, r in reports.items():
        a = r.accuracy_at_km
        ci = f" ({r.median_km_ci95[0]:,.0f}–{r.median_km_ci95[1]:,.0f})" if r.median_km_ci95 else ""
        country = "–" if r.country_accuracy is None else f"{r.country_accuracy:.1%}"
        rows.append(
            f"| {name} | {r.n} | {a[25.0]:.1%} | {a[200.0]:.1%} | {a[750.0]:.1%} | "
            f"{a[2500.0]:.1%} | {r.median_km:,.0f}{ci} | {country} | {r.mean_score:,.0f} |"
        )
    return "\n".join([head, sep, *rows])


def paired_median_delta_ci(
    a: Sequence[float], b: Sequence[float], *, resamples: int = 2000, seed: int = 0
) -> tuple[float, float, float]:
    """Median error of A minus median error of B on the same items, with a 95% CI.

    Resamples items jointly (a paired bootstrap), so the interval reflects how much the
    difference between two systems depends on which photos happened to be in the set. If the
    interval excludes 0, A and B really differ on this kind of photo.
    """
    if len(a) != len(b) or not a:
        raise ValueError("need two equal-length, non-empty lists of distances")
    rng = random.Random(seed)
    n = len(a)
    delta = statistics.median(a) - statistics.median(b)
    deltas = []
    for _ in range(resamples):
        idx = [rng.randrange(n) for _ in range(n)]
        deltas.append(statistics.median(a[i] for i in idx) - statistics.median(b[i] for i in idx))
    deltas.sort()
    lo = deltas[int(0.025 * (resamples - 1))]
    hi = deltas[int(math.ceil(0.975 * (resamples - 1)))]
    return delta, lo, hi


def medoid(points: Sequence[LatLon]) -> LatLon:
    """The point in `points` with the smallest total great-circle distance to all the others.

    Used as the "best single constant guess" baseline. It is fitted on the evaluation set
    itself, so it is an optimistic baseline: no real constant guesser could do better.
    """
    if not points:
        raise ValueError("no points")
    return min(points, key=lambda p: sum(haversine_km(p, q) for q in points))
