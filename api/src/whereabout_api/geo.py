"""Geographic distance and scoring.

These functions define what "distance" means everywhere in Whereabout: player scores,
Atlas's scores and the offline evaluation harness all call the same code, so a benchmark
number and a game result can be compared directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Mean Earth radius (IUGG), in kilometres.
EARTH_RADIUS_KM = 6371.0088

# Distance thresholds used across geolocation literature:
# street, city, region, country, continent.
ACCURACY_THRESHOLDS_KM: tuple[float, ...] = (1.0, 25.0, 200.0, 750.0, 2500.0)

MAX_POINTS = 5000
# A round's maximum after 0, 1, 2 or 3 hints: each hint costs 1,000 of the 5,000.
# Must match MAX_POINTS_BY_HINTS in web/src/lib/geo.ts (data/fixtures/hint_cases.json).
MAX_POINTS_BY_HINTS: tuple[int, ...] = (5000, 4000, 3000, 2000)
MAX_HINTS = len(MAX_POINTS_BY_HINTS) - 1
# Distance at which the score has decayed to 1/e (~37%) of the maximum.
# Chosen so a guess in the right country still earns meaningful points.
SCORE_SCALE_KM = 1500.0


@dataclass(frozen=True, slots=True)
class LatLon:
    """A point on Earth in decimal degrees."""

    lat: float
    lon: float

    def __post_init__(self) -> None:
        validate_coordinates(self.lat, self.lon)


def validate_coordinates(lat: float, lon: float) -> None:
    """Raise ValueError unless lat/lon are finite and within valid ranges."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise ValueError("coordinates must be finite numbers")
    if not -90.0 <= lat <= 90.0:
        raise ValueError(f"latitude {lat} is outside [-90, 90]")
    if not -180.0 <= lon <= 180.0:
        raise ValueError(f"longitude {lon} is outside [-180, 180]")


def haversine_km(a: LatLon, b: LatLon) -> float:
    """Great-circle distance between two points, in kilometres.

    Uses the haversine formula, which is numerically stable for small distances.
    """
    phi1, phi2 = math.radians(a.lat), math.radians(b.lat)
    d_phi = phi2 - phi1
    d_lambda = math.radians(b.lon - a.lon)

    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    # Clamp to guard against floating-point drift just above 1.0 for antipodal points.
    h = min(1.0, max(0.0, h))
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def max_points(hints: int = 0) -> int:
    """The most a round can score after `hints` hints."""
    if not 0 <= hints <= MAX_HINTS:
        raise ValueError(f"hints must be between 0 and {MAX_HINTS}")
    return MAX_POINTS_BY_HINTS[hints]


def score_distance(distance_km: float, hints: int = 0) -> int:
    """Points for a guess `distance_km` away from the truth, after `hints` hints.

    Exponential decay: 5000 points at 0 km, ~1840 at 1500 km, ~0 on the far side of the planet.
    Hints scale the whole curve down, so a hinted guess is worth less at every distance.
    """
    if not math.isfinite(distance_km) or distance_km < 0:
        raise ValueError("distance must be a non-negative finite number")
    return round(max_points(hints) * math.exp(-distance_km / SCORE_SCALE_KM))


def within_thresholds(distance_km: float) -> dict[float, bool]:
    """Which standard accuracy thresholds a guess falls within."""
    return {t: distance_km <= t for t in ACCURACY_THRESHOLDS_KM}
