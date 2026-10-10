"""Baselines every Atlas model has to beat, scored on the same photos.

- Random city: a uniformly random city from the gazetteer, with a fixed seed. Shows what
  "no information at all" scores.
- Best constant guess: the catalog's medoid, the single point closest on average to every
  photo. It is fitted on the evaluation set itself, so it is optimistic on purpose.
"""

from __future__ import annotations

import random
from collections.abc import Sequence

from whereabout_api.geo import LatLon
from whereabout_api.photos import Photo
from whereabout_eval.metrics import medoid
from whereabout_ml.gazetteer import Gazetteer


def random_city_guesses(photos: Sequence[Photo], gazetteer: Gazetteer, seed: int = 0):
    rng = random.Random(seed)
    cities = [c for cs in gazetteer.cities_by_country.values() for c in cs]
    cities.sort(key=lambda c: (c.country, c.name, c.lat, c.lon))
    picks = [rng.choice(cities) for _ in photos]
    return [(LatLon(c.lat, c.lon), c.country) for c in picks]


def constant_guesses(photos: Sequence[Photo]):
    centre = medoid([p.location for p in photos])
    country = next(p.country for p in photos if p.location == centre)
    return [(centre, country) for _ in photos]
