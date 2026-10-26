"""Atlas v0: hierarchical zero-shot geolocation with a CLIP-style image/text encoder.

1. Country: compare the photo with prompts like "a photo taken in Japan." for every country
   (averaging three prompt templates per country, a standard prompt-ensembling trick) and
   softmax the similarities.
2. City: within the top countries, compare the photo with "a photo taken in Kyoto, Japan."
   for each country's largest cities. A city's probability is
   P(country) × P(city | country).
3. The guess is the most probable city. Confidence is the top country's probability.

No training happens here: this is the baseline every trained Atlas model must beat.
The math is pure numpy behind an `Encoder` protocol, so tests use a fake encoder.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from whereabout_ml.clues import CONCEPT_GROUPS, MIN_CLUE_PROBABILITY, ConceptGroup
from whereabout_ml.gazetteer import City, Gazetteer

COUNTRY_TEMPLATES = (
    "a photo taken in {}.",
    "a street view photo from {}.",
    "a landscape photo in {}.",
)
CITY_TEMPLATE = "a photo taken in {}, {}."

# CLIP's learned temperature: similarities are scaled by ~100 before the softmax.
LOGIT_SCALE = 100.0


class Encoder(Protocol):
    """Maps texts and images into the same L2-normalised embedding space."""

    def encode_texts(self, texts: Sequence[str]) -> np.ndarray: ...


def softmax(x: np.ndarray) -> np.ndarray:
    z = x - x.max()
    e = np.exp(z)
    return e / e.sum()


def normalise(x: np.ndarray) -> np.ndarray:
    return x / np.linalg.norm(x, axis=-1, keepdims=True)


@dataclass(frozen=True, slots=True)
class Clue:
    label: str
    p: float
    # The concept group the clue answers ("climate", "driving_side", ...), so a better source
    # for one group (a trained clue head, `whereabout_ml.clue_heads`) can replace just that one.
    group: str = ""


@dataclass(frozen=True, slots=True)
class Guess:
    lat: float
    lon: float
    city: str
    country: str
    confidence: float
    top_countries: tuple[tuple[str, float], ...]
    clues: tuple[Clue, ...]


class ZeroShotGeolocator:
    def __init__(
        self,
        encoder: Encoder,
        gazetteer: Gazetteer,
        *,
        top_k_countries: int = 3,
        report_top_countries: int | None = None,
        concept_groups: Sequence[ConceptGroup] = CONCEPT_GROUPS,
    ) -> None:
        self.encoder = encoder
        self.gazetteer = gazetteer
        self.top_k = top_k_countries
        # How many countries a Guess reports. The city step still searches only `top_k`, so
        # reporting more (the reveal's shortlist) never changes where Atlas guesses.
        self.report_top = max(top_k_countries, report_top_countries or top_k_countries)
        self.groups = tuple(concept_groups)

        names = [c.name for c in gazetteer.countries]
        per_template = [
            normalise(encoder.encode_texts([t.format(n) for n in names])) for t in COUNTRY_TEMPLATES
        ]
        self.country_embeddings = normalise(np.mean(per_template, axis=0))
        self.group_embeddings = [
            normalise(encoder.encode_texts([prompt for _, prompt in g.options]))
            for g in self.groups
        ]
        self._city_cache: dict[str, np.ndarray] = {}

    def _city_embeddings(self, country_code: str, country_name: str) -> np.ndarray:
        if country_code not in self._city_cache:
            cities = self.gazetteer.cities_by_country[country_code]
            prompts = [CITY_TEMPLATE.format(c.name, country_name) for c in cities]
            self._city_cache[country_code] = normalise(self.encoder.encode_texts(prompts))
        return self._city_cache[country_code]

    def concept_probabilities(self, image_embedding: np.ndarray) -> dict[str, np.ndarray]:
        """Softmax over each concept group's options, in the group's option order."""
        return {
            group.name: softmax(LOGIT_SCALE * emb @ image_embedding)
            for group, emb in zip(self.groups, self.group_embeddings, strict=True)
        }

    def clues(self, image_embedding: np.ndarray) -> tuple[Clue, ...]:
        found = []
        probabilities = self.concept_probabilities(image_embedding)
        for group in self.groups:
            p = probabilities[group.name]
            best = int(np.argmax(p))
            if p[best] >= MIN_CLUE_PROBABILITY:
                found.append(Clue(group.options[best][0], float(p[best]), group.name))
        return tuple(sorted(found, key=lambda c: -c.p))

    def country_probabilities(self, image_embedding: np.ndarray) -> np.ndarray:
        image = normalise(np.asarray(image_embedding, dtype=np.float64))
        return softmax(LOGIT_SCALE * self.country_embeddings @ image)

    def _reported(self, p_country: np.ndarray) -> tuple[tuple[str, float], ...]:
        order = np.argsort(-p_country)[: self.report_top]
        return tuple((self.gazetteer.countries[int(i)].code, float(p_country[i])) for i in order)

    def predict_country_only(self, image_embedding: np.ndarray) -> Guess:
        """Ablation: stop after the country step and guess its largest city.

        Comparing this with `predict` measures what the city step adds.
        """
        image = normalise(np.asarray(image_embedding, dtype=np.float64))
        p_country = self.country_probabilities(image)
        order = np.argsort(-p_country)[: self.top_k]
        country = self.gazetteer.countries[int(order[0])]
        city = self.gazetteer.cities_by_country[country.code][0]
        return Guess(
            lat=city.lat,
            lon=city.lon,
            city=city.name,
            country=city.country,
            confidence=float(p_country[order[0]]),
            top_countries=self._reported(p_country),
            clues=(),
        )

    def predict(self, image_embedding: np.ndarray) -> Guess:
        image = normalise(np.asarray(image_embedding, dtype=np.float64))
        countries = self.gazetteer.countries
        p_country = self.country_probabilities(image)
        order = np.argsort(-p_country)[: self.top_k]

        best: tuple[float, City] | None = None
        for idx in order:
            country = countries[int(idx)]
            emb = self._city_embeddings(country.code, country.name)
            p_city = softmax(LOGIT_SCALE * emb @ image)
            j = int(np.argmax(p_city))
            joint = float(p_country[idx] * p_city[j])
            if best is None or joint > best[0]:
                best = (joint, self.gazetteer.cities_by_country[country.code][j])

        if best is None:
            raise RuntimeError("gazetteer has no countries")
        city = best[1]
        return Guess(
            lat=city.lat,
            lon=city.lon,
            city=city.name,
            country=city.country,
            confidence=float(p_country[order[0]]),
            top_countries=self._reported(p_country),
            clues=self.clues(image),
        )
