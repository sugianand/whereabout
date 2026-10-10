"""Countries and cities from GeoNames (CC BY 4.0, https://www.geonames.org).

Files used:
- `countryInfo.txt`: ISO code, name, population per country.
- `cities15000.txt`: every populated place with at least 15,000 people.
Both are tab-separated; comment lines in countryInfo start with "#".
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Country:
    code: str
    name: str


@dataclass(frozen=True, slots=True)
class City:
    name: str
    country: str
    lat: float
    lon: float
    population: int


def parse_countries(lines: Iterable[str]) -> list[Country]:
    countries = []
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.rstrip("\n").split("\t")
        code, name = cols[0], cols[4]
        if len(code) == 2 and name:
            countries.append(Country(code=code, name=name))
    return countries


# cities15000 columns: 1 name, 2 asciiname, 4 latitude, 5 longitude, 8 country code, 14 population
def parse_cities(lines: Iterable[str]) -> list[City]:
    cities = []
    for line in lines:
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 15:
            continue
        cities.append(
            City(
                name=cols[2] or cols[1],
                country=cols[8],
                lat=float(cols[4]),
                lon=float(cols[5]),
                population=int(cols[14] or 0),
            )
        )
    return cities


@dataclass(frozen=True, slots=True)
class Gazetteer:
    countries: tuple[Country, ...]
    cities_by_country: dict[str, tuple[City, ...]]

    @classmethod
    def build(
        cls, countries: Iterable[Country], cities: Iterable[City], *, cities_per_country: int = 40
    ) -> Gazetteer:
        """Keep countries that have at least one city, and each country's largest cities."""
        grouped: dict[str, list[City]] = defaultdict(list)
        for c in cities:
            grouped[c.country].append(c)
        top = {
            code: tuple(sorted(cs, key=lambda c: -c.population)[:cities_per_country])
            for code, cs in grouped.items()
        }
        kept = tuple(c for c in countries if c.code in top)
        return cls(countries=kept, cities_by_country={c.code: top[c.code] for c in kept})

    @classmethod
    def load(cls, directory: Path, **kwargs) -> Gazetteer:
        with (directory / "countryInfo.txt").open(encoding="utf-8") as fh:
            countries = parse_countries(fh)
        with (directory / "cities15000.txt").open(encoding="utf-8") as fh:
            cities = parse_cities(fh)
        return cls.build(countries, cities, **kwargs)
