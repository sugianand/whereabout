"""Hints for points: up to three clues per round, each lowering the round's maximum score.

The clues come in a fixed order, broadest first: the continent (from the photo's country),
which side of the road traffic drives on, then the climate group (both from
data/labels/concept_labels.csv). A photo without a label simply has fewer hints. The web game
builds the same clues with the same words (web/src/lib/hints.ts); both test suites check
against data/fixtures/hint_cases.json.
"""

from __future__ import annotations

import csv
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

ClueKind = Literal["continent", "driving_side", "climate"]

# ISO 3166-1 alpha-2 code to continent. Same seven-continent table as web/src/lib/continents.ts:
# transcontinental countries go where most of their people live.
_BY_CONTINENT: dict[str, str] = {
    "Africa": (
        "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS "
        "LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN "
        "UG EH ZM ZW"
    ),
    "Asia": (
        "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV "
        "MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE"
    ),
    "Europe": (
        "AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV "
        "LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA"
    ),
    "North America": (
        "AI AG AW BS BB BZ BM BQ CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI "
        "PA PR BL KN LC MF PM VC SX TT TC US VG VI"
    ),
    "South America": "AR BO BR CL CO EC FK GF GY PY PE SR UY VE",
    "Oceania": "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF",
    "Antarctica": "AQ BV GS HM TF",
}

CONTINENT_OF: Mapping[str, str] = {
    code: continent for continent, codes in _BY_CONTINENT.items() for code in codes.split()
}

DRIVING_SIDES = ("left", "right")
CLIMATE_GROUPS = ("Tropical", "Arid", "Temperate", "Continental", "Polar")


@dataclass(frozen=True, slots=True)
class Clue:
    kind: ClueKind
    text: str


@dataclass(frozen=True, slots=True)
class PhotoLabels:
    """The concept labels hints are made from; None where the maps gave no label."""

    driving_side: str | None = None
    climate_group: str | None = None


def clues_for(country: str | None, labels: PhotoLabels | None) -> tuple[Clue, ...]:
    """Every hint a photo offers, in the order they are given."""
    clues: list[Clue] = []
    continent = CONTINENT_OF.get((country or "").upper())
    if continent:
        clues.append(Clue("continent", f"It's in {continent}"))
    if labels and labels.driving_side in DRIVING_SIDES:
        clues.append(Clue("driving_side", f"Traffic drives on the {labels.driving_side}"))
    if labels and labels.climate_group in CLIMATE_GROUPS:
        clues.append(Clue("climate", f"The climate is {labels.climate_group.lower()}"))
    return tuple(clues)


def load_labels(path: Path) -> dict[str, PhotoLabels]:
    """Concept labels by photo id. A missing file means no label-based hints, not an error:
    the continent hint still works from the catalog's country."""
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as fh:
        return {
            row["id"]: PhotoLabels(
                driving_side=(row.get("driving_side") or "").strip() or None,
                climate_group=(row.get("climate_group") or "").strip() or None,
            )
            for row in csv.DictReader(fh)
            if row.get("id")
        }
