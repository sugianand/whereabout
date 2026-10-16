"""Build a small labelled fixture of photos the scene gate should reject.

The scene gate (`whereabout_ml.scene_gate`) turns away images that are not outdoor place photos:
pictures of people, interiors, signs and text, and non-photos (maps, paintings, diagrams).
Its thresholds are checked against this fixture:

    python -m whereabout_ml.reject_fixture --out data/scene_gate/rejects.csv

Each label is drawn from a few Wikimedia Commons categories (`LABEL_CATEGORIES`). The label is
the *category* the file came from, not a human review: a file in "Interiors of churches" is
labelled `indoor` without anyone having looked at it. Expect some noise.

Only openly licensed raster images are kept (the same allow-list as `ingest`). Unlike catalog
photos, rejects need no camera coordinates, and identifiable people are fine here: the files are
only scored, never shown in the game. License, author and the Commons page are recorded per row.
"""

from __future__ import annotations

import argparse
import csv
import urllib.parse
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path

from whereabout_ml.ingest import (
    COMMONS_API,
    THUMB_WIDTH,
    CommonsFile,
    fetch_metadata,
    html_to_text,
    http_get_json,
    normalize_license,
    write_csv,
)

LABEL_CATEGORIES: dict[str, tuple[str, ...]] = {
    "people": ("Category:Portrait photographs", "Category:Group photographs"),
    "indoor": (
        "Category:Interiors of churches",
        "Category:Interiors of railway stations",
        "Category:Hotel rooms",
    ),
    "text": (
        "Category:Road signs with place names",
        "Category:Shop signs",
        "Category:Town name signs",
    ),
    "not_photo": (
        "Category:Maps of cities",
        "Category:Paintings of landscapes",
        "Category:Diagrams",
        "Category:Screenshots",
    ),
    "close_up": (
        "Category:Featured pictures of birds",
        "Category:Featured pictures of insects",
        "Category:Featured pictures of flowers",
        "Category:Macro photographs",
    ),
}
FIELDS = ("title", "label", "image_url", "author", "license", "source_url")
RASTER_MIMES = ("image/jpeg", "image/png")
# Members listed per category before filtering: most files fail the license or type check.
LIST_LIMIT = 200
PAGE_SIZE = 50

Http = Callable[[str], Mapping]


def category_files(
    category: str,
    api_url: str = COMMONS_API,
    limit: int = LIST_LIMIT,
    http: Http = http_get_json,
) -> list[str]:
    """Up to `limit` "File:" titles in a Commons category, following `cmcontinue`."""
    titles: list[str] = []
    cont: str | None = None
    while len(titles) < limit:
        params = {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "list": "categorymembers",
            "cmtitle": category,
            "cmtype": "file",
            "cmlimit": str(min(PAGE_SIZE, limit - len(titles))),
        }
        if cont:
            params["cmcontinue"] = cont
        data = http(f"{api_url}?{urllib.parse.urlencode(params)}")
        titles += [str(m["title"]) for m in data.get("query", {}).get("categorymembers", [])]
        cont = (data.get("continue") or {}).get("cmcontinue")
        if not cont:
            break
    return titles[:limit]


def reject_row(file: CommonsFile, label: str) -> dict[str, str] | None:
    """A fixture row for an openly licensed raster image, else None (no coordinates needed)."""
    if file.mime not in RASTER_MIMES:
        return None
    license_ = normalize_license(file.meta.get("LicenseShortName", ""))
    if license_ is None:
        return None
    author = html_to_text(file.meta.get("Artist", ""))
    if not author and license_ not in ("CC0", "Public domain"):
        return None
    return {
        "title": file.title,
        "label": label,
        "image_url": file.thumb_url,
        "author": author,
        "license": license_,
        "source_url": file.source_url,
    }


def build_fixture(
    per_label: int,
    api_url: str = COMMONS_API,
    thumb_width: int = THUMB_WIDTH,
    http: Http = http_get_json,
    categories: Mapping[str, Sequence[str]] | None = None,
    exclude: Iterable[str] = (),
) -> list[dict[str, str]]:
    """Up to `per_label` usable files per label, in label order then title order. Titles in
    `exclude` (already in the fixture under another label) are never picked."""
    rows: list[dict[str, str]] = []
    seen: set[str] = set(exclude)
    for label, cats in (categories or LABEL_CATEGORIES).items():
        titles: set[str] = set()
        for cat in cats:
            titles.update(category_files(cat, api_url, http=http))
        titles -= seen  # a file in two labels' categories keeps its first label
        files, _ = fetch_metadata(
            sorted(titles), get_json=http, api_url=api_url, thumb_width=thumb_width
        )
        kept = []
        for title in sorted(files):
            row = reject_row(files[title], label)
            if row is not None:
                kept.append(row)
            if len(kept) == per_label:
                break
        seen.update(r["title"] for r in kept)
        rows += kept
    return rows


def missing_labels(rows: Sequence[Mapping[str, str]]) -> list[str]:
    """Labels in `LABEL_CATEGORIES` with no row yet, in label order. A reason added to the scene
    gate gets its fixture rows appended; rows already in the fixture stay as they are, so the
    other reasons' checks do not move."""
    have = {r["label"] for r in rows}
    return [label for label in LABEL_CATEGORIES if label not in have]


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=Path("data/scene_gate/rejects.csv"))
    ap.add_argument("--per-label", type=int, default=12)
    ap.add_argument("--thumb-width", type=int, default=THUMB_WIDTH)
    ap.add_argument("--api-url", default=COMMONS_API)
    ap.add_argument("--force", action="store_true", help="rebuild even if --out exists")
    args = ap.parse_args(argv)

    existing: list[dict[str, str]] = []
    if args.out.exists() and not args.force:
        with args.out.open(newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    labels = missing_labels(existing)
    if not labels:
        print(f"{args.out} has every label; skipping (use --force to rebuild)")
        return 0
    added = build_fixture(
        args.per_label,
        args.api_url,
        args.thumb_width,
        categories={label: LABEL_CATEGORIES[label] for label in labels},
        exclude={r["title"] for r in existing},
    )
    rows = existing + added
    write_csv(args.out, FIELDS, rows)
    counts = Counter(r["label"] for r in rows)
    for label in LABEL_CATEGORIES:
        print(f"{label}: {counts[label]}")
    print(f"wrote {len(rows)} rows to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
