"""Load and validate the curated photo catalog (data/curation/photos.csv).

Every photo must be openly licensed, geotagged, attributed and served over HTTPS. The loader
fails loudly on a bad row instead of silently skipping it: a broken catalog is a bug to fix,
not something the game should paper over.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from urllib.parse import urlparse

from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo

REQUIRED_COLUMNS = (
    "id",
    "image_url",
    "lat",
    "lon",
    "place",
    "country",
    "author",
    "license",
    "source_url",
)

# Licenses that allow public display with attribution. Non-commercial and no-derivatives
# licenses are deliberately excluded.
ALLOWED_LICENSE = re.compile(r"^(CC BY(-SA)? \d(\.\d)?( [a-z]{2})?|CC0|Public domain)$")

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
_COUNTRY = re.compile(r"^[A-Z]{2}$")


class CatalogError(ValueError):
    """Raised when the catalog file is malformed. The message names the row."""


def _https_url(value: str, field: str, row: int) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise CatalogError(f"row {row}: {field} must be an https URL, got {value!r}")
    return value


def parse_row(raw: dict[str, str], row: int) -> Photo:
    """Turn one CSV row into a Photo, validating every field."""
    missing = [c for c in REQUIRED_COLUMNS if not (raw.get(c) or "").strip()]
    if missing:
        raise CatalogError(f"row {row}: missing {', '.join(missing)}")

    photo_id = raw["id"].strip()
    if not _ID.match(photo_id):
        raise CatalogError(f"row {row}: invalid id {photo_id!r}")

    try:
        location = LatLon(float(raw["lat"]), float(raw["lon"]))
    except ValueError as exc:
        raise CatalogError(f"row {row}: bad coordinates ({exc})") from exc

    country = raw["country"].strip()
    if not _COUNTRY.match(country):
        raise CatalogError(f"row {row}: country must be an ISO 3166-1 alpha-2 code")

    license_name = raw["license"].strip()
    if not ALLOWED_LICENSE.match(license_name):
        raise CatalogError(f"row {row}: license {license_name!r} is not an allowed open license")

    return Photo(
        id=photo_id,
        location=location,
        place_name=raw["place"].strip(),
        image_url=_https_url(raw["image_url"].strip(), "image_url", row),
        attribution=raw["author"].strip(),
        license=license_name,
        country=country,
        source_url=_https_url(raw["source_url"].strip(), "source_url", row),
    )


def load_catalog(path: Path) -> tuple[Photo, ...]:
    """Load every photo from a catalog CSV. Raises CatalogError on any invalid row."""
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = tuple(reader.fieldnames or ())
        absent = [c for c in REQUIRED_COLUMNS if c not in header]
        if absent:
            raise CatalogError(f"header is missing columns: {', '.join(absent)}")

        photos: list[Photo] = []
        seen: set[str] = set()
        # Row numbers match what an editor shows: the header is line 1.
        for row_number, raw in enumerate(reader, start=2):
            photo = parse_row(raw, row_number)
            if photo.id in seen:
                raise CatalogError(f"row {row_number}: duplicate id {photo.id!r}")
            seen.add(photo.id)
            photos.append(photo)

    if not photos:
        raise CatalogError("catalog is empty")
    return tuple(photos)
