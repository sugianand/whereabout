"""Concept labels derived from where a photo was taken, not from what it shows.

Atlas v1's clue heads (docs/architecture.md) learn to see things like driving side, climate and
land cover. Their training labels come from open maps looked up by a photo's coordinates or
country, so no one has to hand-label images. This module holds those lookups.

Driving side is the first: it is a fact about the country, it is one of the strongest clues
expert players use, and it is free to label.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from typing import Literal

from whereabout_api.photos import Photo

DrivingSide = Literal["left", "right"]

# ISO 3166-1 alpha-2 codes of countries and territories that drive on the left, as of 2026.
# Everywhere else drives on the right. Sources: national highway codes, summarised in
# Wikipedia's "Left- and right-hand traffic" list. Notable edge cases are spelled out so that a
# future edit has to argue with them:
#   - Samoa (WS) switched to the left in 2009.
#   - Myanmar (MM) switched to the right in 1970, though many cars are still right-hand drive.
#   - Rwanda (RW), Burundi (BI) and Gibraltar (GI) drive on the right.
#   - The US Virgin Islands (VI) drive on the left, unlike the rest of the US.
LEFT_HAND_TRAFFIC: frozenset[str] = frozenset(
    {
        # Europe
        "CY", "GB", "GG", "IE", "IM", "JE", "MT",
        # Asia
        "BD", "BN", "BT", "HK", "ID", "IN", "JP", "LK", "MO", "MV", "MY", "NP", "PK", "SG",
        "TH", "TL",
        # Africa
        "BW", "KE", "LS", "MU", "MW", "MZ", "NA", "SC", "SH", "SZ", "TZ", "UG", "ZA", "ZM",
        "ZW",
        # Oceania
        "AU", "CC", "CK", "CX", "FJ", "KI", "NF", "NR", "NU", "NZ", "PG", "PN", "SB", "TK",
        "TO", "TV", "WS",
        # Americas and the Caribbean
        "AG", "AI", "BB", "BM", "BS", "DM", "FK", "GD", "GY", "JM", "KN", "KY", "LC", "MS",
        "SR", "TC", "TT", "VC", "VG", "VI",
    }
)  # fmt: skip

_ALPHA2 = re.compile(r"^[A-Z]{2}$")


def driving_side(country: str) -> DrivingSide:
    """Which side of the road traffic keeps to in `country` (an ISO 3166-1 alpha-2 code)."""
    code = country.strip().upper()
    if not _ALPHA2.match(code):
        raise ValueError(f"{country!r} is not an ISO 3166-1 alpha-2 country code")
    return "left" if code in LEFT_HAND_TRAFFIC else "right"


def photo_driving_side(photo: Photo) -> DrivingSide | None:
    """The driving-side label for a photo, or None when its country is unknown."""
    return driving_side(photo.country) if photo.country else None


def label_balance(photos: Iterable[Photo]) -> Counter[str]:
    """How many photos carry each driving-side label ("unknown" when there is no country).

    Left-hand traffic covers roughly a third of the world's people but far fewer of its
    countries, so a training set is usually lopsided. Checking the balance before training a
    head tells you whether it needs class weights.
    """
    return Counter(photo_driving_side(p) or "unknown" for p in photos)
