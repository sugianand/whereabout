"""Concept labels derived from coordinates, for training Atlas v1's clue heads.

A clue head ("which side of the road do they drive on?") needs a label for every training
photo. Nobody hand-labels millions of photos, but every photo has a latitude and longitude, and
some concepts follow from *where* a photo is rather than from what it shows. So labels are looked
up from open maps by coordinates (docs/architecture.md, "Clue heads").

The first such concept is the driving side, which is set per country:

    (lat, lon) --CountryLocator--> ISO 3166-1 alpha-2 code --table--> "left" | "right" | None

`None` means "no label": the point is at sea, in a territory without a public road network, or
in a country code we do not know. A head is trained only on labelled photos, so unknown is
always safer than a guess.

Limitations, stated rather than hidden: the label is the country's rule, not a reading of the
photo (a photo of a desert with no road still gets one; the head learns from the scenes where
it shows). Near a border, `NearestPlaceLocator` can pick the neighbour's country.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Literal, Protocol

import numpy as np

from whereabout_api.geo import LatLon
from whereabout_ml.gazetteer import City
from whereabout_ml.geocells import haversine_matrix

DrivingSide = Literal["left", "right"]


def _codes(block: str) -> frozenset[str]:
    return frozenset(block.split())


# Every officially assigned ISO 3166-1 alpha-2 code, so a typo is "unknown", not "right".
ISO_3166_ALPHA2: frozenset[str] = _codes(
    """
    AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR
    BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ
    EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW
    GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY
    KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV
    MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
    QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG
    TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM
    ZW
    """
)

# Countries and territories that drive on the left. Source: the list of left-hand traffic
# jurisdictions in "Left- and right-hand traffic" (Wikipedia, CC BY-SA 4.0), checked against
# national highway codes where the two disagreed. Everything else in ISO_3166_ALPHA2 drives on
# the right, except the codes in NO_ROAD_TRAFFIC.
LEFT_HAND_TRAFFIC: frozenset[str] = _codes(
    """
    AG AI AU BB BD BM BN BS BT BW CC CK CX CY DM FJ FK GB GD GG GY HK ID IE IM IN JE JM JP KE
    KI KN KY LC LK LS MO MS MT MU MV MW MY MZ NA NF NP NR NU NZ PG PK PN SB SC SG SH SR SZ TC
    TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW
    """
)

# Uninhabited or research-station territories, and the British Indian Ocean Territory (a
# military base with its own rules): no meaningful public road convention to learn from.
NO_ROAD_TRAFFIC: frozenset[str] = frozenset({"AQ", "BV", "GS", "HM", "IO", "TF", "UM"})


def driving_side(country: str | None) -> DrivingSide | None:
    """The side of the road traffic keeps to in `country` (ISO alpha-2), or None if unknown."""
    if not country:
        return None
    code = country.strip().upper()
    if code not in ISO_3166_ALPHA2 or code in NO_ROAD_TRAFFIC:
        return None
    return "left" if code in LEFT_HAND_TRAFFIC else "right"


class CountryLocator(Protocol):
    """Reverse geocoding to country level. Returns None at sea or when nothing is close."""

    def countries(self, points: Sequence[LatLon]) -> list[str | None]: ...


class NearestPlaceLocator:
    """Country of the nearest known populated place, if it is within `max_km`.

    Built from GeoNames' cities15000 (CC BY 4.0) in practice. Cheap, offline and dense where
    photos are; borders are approximate, which is acceptable for a per-country label. Points
    farther than `max_km` from every place (open ocean, ice sheets) get None.
    """

    def __init__(self, places: Iterable[City], *, max_km: float = 150.0, chunk: int = 256):
        places = [p for p in places if p.country]
        if not places:
            raise ValueError("no places to locate against")
        if max_km <= 0:
            raise ValueError("max_km must be positive")
        self._lat = np.array([p.lat for p in places])
        self._lon = np.array([p.lon for p in places])
        self._country = np.array([p.country.upper() for p in places])
        self.max_km = max_km
        self._chunk = chunk  # bounds memory: chunk × n_places distances at a time

    def countries(self, points: Sequence[LatLon]) -> list[str | None]:
        out: list[str | None] = []
        for start in range(0, len(points), self._chunk):
            batch = points[start : start + self._chunk]
            d = haversine_matrix(
                [p.lat for p in batch], [p.lon for p in batch], self._lat, self._lon
            )
            nearest = d.argmin(axis=1)
            for row, j in enumerate(nearest):
                out.append(str(self._country[j]) if d[row, j] <= self.max_km else None)
        return out


def driving_side_labels(
    points: Sequence[LatLon], locator: CountryLocator
) -> list[DrivingSide | None]:
    """Driving-side label for each point (None where the country or the rule is unknown)."""
    return [driving_side(c) for c in locator.countries(points)]
