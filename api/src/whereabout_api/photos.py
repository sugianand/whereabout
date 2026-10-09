"""Photo catalog.

For Milestone 1 this is a tiny fixture set with known locations so the game loop can be built
and tested. Real, openly licensed photos with attribution replace it in Milestone 3.
"""

from __future__ import annotations

from dataclasses import dataclass

from whereabout_api.geo import LatLon


@dataclass(frozen=True, slots=True)
class Photo:
    id: str
    location: LatLon
    place_name: str
    image_url: str | None = None
    attribution: str | None = None
    license: str | None = None


# Development fixtures: locations only, no images yet.
DEV_PHOTOS: tuple[Photo, ...] = (
    Photo("dev-reykjavik", LatLon(64.1466, -21.9426), "Reykjavík, Iceland"),
    Photo("dev-kyoto", LatLon(35.0116, 135.7681), "Kyoto, Japan"),
    Photo("dev-cape-town", LatLon(-33.9249, 18.4241), "Cape Town, South Africa"),
    Photo("dev-cusco", LatLon(-13.5320, -71.9675), "Cusco, Peru"),
    Photo("dev-queenstown", LatLon(-45.0312, 168.6626), "Queenstown, New Zealand"),
)
