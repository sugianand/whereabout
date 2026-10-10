"""Atlas v0's pipeline, tested with a fake encoder whose embedding space we control."""

import numpy as np
import pytest

from whereabout_ml.clues import ConceptGroup
from whereabout_ml.gazetteer import City, Country, Gazetteer, parse_cities, parse_countries
from whereabout_ml.zeroshot import ZeroShotGeolocator, softmax

VOCAB = ["Japan", "Kyoto", "Osaka", "Peru", "Cusco", "Lima", "snow", "desert"]


class KeywordEncoder:
    """Embeds a text as the bag of known keywords it contains (one dimension per keyword)."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def encode_texts(self, texts):
        self.calls.append(list(texts))
        out = np.full((len(texts), len(VOCAB)), 1e-3)
        for i, t in enumerate(texts):
            for j, w in enumerate(VOCAB):
                if w in t:
                    out[i, j] = 1.0
        return out / np.linalg.norm(out, axis=1, keepdims=True)


def image(*words: str) -> np.ndarray:
    v = np.full(len(VOCAB), 1e-3)
    for w in words:
        v[VOCAB.index(w)] = 1.0
    return v


GAZ = Gazetteer.build(
    [Country("JP", "Japan"), Country("PE", "Peru"), Country("XX", "Nowhere")],
    [
        City("Osaka", "JP", 34.69, 135.50, 2_700_000),
        City("Kyoto", "JP", 35.01, 135.77, 1_400_000),
        City("Lima", "PE", -12.05, -77.04, 8_000_000),
        City("Cusco", "PE", -13.53, -71.97, 430_000),
    ],
)
GROUPS = (ConceptGroup("climate", (("Snow and ice", "a snow scene"), ("Desert", "a desert"))),)


def test_gazetteer_drops_countries_without_cities_and_sorts_by_population():
    assert [c.code for c in GAZ.countries] == ["JP", "PE"]
    assert [c.name for c in GAZ.cities_by_country["PE"]] == ["Lima", "Cusco"]


def test_picks_the_right_country_and_city():
    locator = ZeroShotGeolocator(KeywordEncoder(), GAZ, top_k_countries=2, concept_groups=GROUPS)
    guess = locator.predict(image("Peru", "Cusco"))
    assert guess.country == "PE" and guess.city == "Cusco"
    assert (guess.lat, guess.lon) == (-13.53, -71.97)
    assert guess.top_countries[0][0] == "PE"
    assert guess.confidence > 0.9


def test_city_prompts_are_encoded_once_per_country():
    enc = KeywordEncoder()
    locator = ZeroShotGeolocator(enc, GAZ, top_k_countries=1, concept_groups=GROUPS)
    before = len(enc.calls)
    locator.predict(image("Japan", "Kyoto"))
    locator.predict(image("Japan", "Osaka"))
    city_calls = enc.calls[before:]
    assert city_calls == [["a photo taken in Osaka, Japan.", "a photo taken in Kyoto, Japan."]]


def test_clues_only_when_confident():
    locator = ZeroShotGeolocator(KeywordEncoder(), GAZ, concept_groups=GROUPS)
    assert [c.label for c in locator.predict(image("Japan", "snow")).clues] == ["Snow and ice"]
    # Equal evidence for both options: no clue is shown.
    assert locator.predict(image("Japan", "snow", "desert")).clues == ()


def test_softmax_is_stable_for_large_logits():
    p = softmax(np.array([1000.0, 1000.0, 0.0]))
    assert p.sum() == pytest.approx(1.0) and p[0] == pytest.approx(0.5)


def test_parsers_read_geonames_formats():
    countries = parse_countries(
        ["#ISO\tISO3\tISO-Numeric\tfips\tCountry\n", "JP\tJPN\t392\tJA\tJapan\tTokyo\n"]
    )
    assert countries == [Country("JP", "Japan")]
    row = ["1", "Kyōto", "Kyoto", "", "35.02", "135.75", "P", "PPLA", "JP"] + [""] * 5 + ["1459640"]
    (city,) = parse_cities(["\t".join(row) + "\n"])
    assert city == City("Kyoto", "JP", 35.02, 135.75, 1459640)


def test_country_only_ablation_stops_at_the_largest_city():
    locator = ZeroShotGeolocator(KeywordEncoder(), GAZ, top_k_countries=2, concept_groups=GROUPS)
    guess = locator.predict_country_only(image("Peru", "Cusco"))
    assert (guess.country, guess.city) == ("PE", "Lima")
    assert guess.clues == ()
