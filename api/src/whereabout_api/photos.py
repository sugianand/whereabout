"""Photo model and the small development fixture set used by tests."""

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
    country: str | None = None
    source_url: str | None = None


# Development fixtures: locations only, no images. The real catalog lives in
# data/curation/photos.csv and is loaded by whereabout_api.catalog.
DEV_PHOTOS: tuple[Photo, ...] = (
    Photo("dev-reykjavik", LatLon(64.1466, -21.9426), "Reykjavík, Iceland", country="IS"),
    Photo("dev-kyoto", LatLon(35.0116, 135.7681), "Kyoto, Japan", country="JP"),
    Photo("dev-cape-town", LatLon(-33.9249, 18.4241), "Cape Town, South Africa", country="ZA"),
    Photo("dev-cusco", LatLon(-13.5320, -71.9675), "Cusco, Peru", country="PE"),
    Photo("dev-queenstown", LatLon(-45.0312, 168.6626), "Queenstown, New Zealand", country="NZ"),
)
