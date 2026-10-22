"""Retrieval refinement with hand-made embeddings: no network, no model weights."""

import json

import numpy as np
import pytest

from whereabout_api.geo import LatLon, haversine_km
from whereabout_api.photos import Photo
from whereabout_ml.retrieval import (
    GamePhotoTrace,
    Reference,
    ReferenceIndex,
    leakage_filter,
    load_references,
    ships,
)
from whereabout_ml.run_atlas_v0 import (
    System,
    build_outputs,
    predictions_from_guesses,
    refine_with_references,
)
from whereabout_ml.zeroshot import Guess


def ref(i, lat, lon, country="IT", place=None, author="X", url=None):
    return Reference(
        f"wr{i}", lat, lon, country, place or f"Place {i}", author, url or f"https://c/{i}"
    )


def onehot(i, dim=8):
    v = np.full(dim, 1e-3)
    v[i] = 1.0
    return v


def guess(lat, lon, country="IT", city="Rome"):
    return Guess(lat, lon, city, country, 0.7, ((country, 0.7),), ())


# --- the index -------------------------------------------------------------------------------


def test_the_pin_moves_to_where_the_look_alikes_agree_not_to_one_outlier():
    # Three near-identical look-alikes around Bolzano, and one slightly more similar outlier in
    # Sicily: the weighted medoid stays with the cluster.
    refs = [
        ref(0, 37.5, 14.0, place="Enna"),
        ref(1, 46.50, 11.35, place="Bolzano"),
        ref(2, 46.52, 11.30, place="Bolzano North"),
        ref(3, 46.48, 11.40, place="Bolzano South"),
    ]
    q = onehot(0)
    emb = np.stack([q + 0.02 * onehot(5), q + 0.05 * onehot(1), q + 0.05 * onehot(2), q])
    index = ReferenceIndex(refs, emb, k=4)
    moved, did = index.refine(q, guess(41.9, 12.5))
    assert did
    assert moved.city.startswith("Bolzano")
    assert haversine_km(LatLon(moved.lat, moved.lon), LatLon(46.5, 11.35)) < 10
    # Everything but the pin and the place name is still Atlas v0's.
    assert (moved.country, moved.confidence, moved.top_countries) == ("IT", 0.7, (("IT", 0.7),))


def test_only_references_in_atlas_s_country_are_searched():
    refs = [
        ref(0, 47.0, 8.0, "CH"),
        ref(1, 45.0, 7.6, "IT"),
        ref(2, 45.1, 7.7, "IT"),
        ref(3, 45.0, 7.7, "IT"),
    ]
    emb = np.stack([onehot(0), onehot(1), onehot(1), onehot(1)])
    index = ReferenceIndex(refs, emb, k=3)
    # The query looks exactly like the Swiss photo, but Atlas said Italy.
    found = index.neighbours(onehot(0), "IT")
    assert {r.country for r, _ in found} == {"IT"}


def test_too_few_references_in_the_country_leave_the_guess_alone():
    refs = [ref(0, 45.0, 7.6), ref(1, 45.1, 7.7)]
    index = ReferenceIndex(refs, np.stack([onehot(0), onehot(1)]), min_references=3)
    g = guess(41.9, 12.5)
    assert index.refine(onehot(0), g) == (g, False)
    assert index.refine(onehot(0), guess(35.0, 135.0, "JP")) == (guess(35.0, 135.0, "JP"), False)


def test_neighbours_are_the_k_most_similar_in_order():
    refs = [ref(i, 45.0 + i / 10, 9.0) for i in range(5)]
    emb = np.stack([onehot(0) + w * onehot(1) for w in (0.0, 2.0, 0.5, 4.0, 1.0)])
    found = ReferenceIndex(refs, emb, k=3).neighbours(onehot(0), "it")
    assert [r.id for r, _ in found] == ["wr0", "wr2", "wr4"]
    sims = [s for _, s in found]
    assert sims == sorted(sims, reverse=True)


def test_index_rejects_mismatched_embeddings_and_bad_settings():
    with pytest.raises(ValueError, match="one embedding row"):
        ReferenceIndex([ref(0, 1, 1)], np.zeros((2, 4)))
    with pytest.raises(ValueError):
        ReferenceIndex([ref(0, 1, 1)], np.ones((1, 4)), k=0)


# --- leakage ---------------------------------------------------------------------------------


def test_leakage_guard_drops_game_photos_in_disguise():
    game = [
        GamePhotoTrace(45.0, 7.0, "Ann Smith", "https://c/game", 0b1111_0000),
        GamePhotoTrace(-33.9, 18.4, "", "https://c/game2", None),
    ]
    refs = [
        ref(0, 10.0, 10.0, url="https://c/game"),  # the same Commons file
        ref(1, 10.0, 10.0),  # pHash 2 bits from a game photo
        ref(2, 45.05, 7.05, author="ann  SMITH"),  # same photographer, 7 km away
        ref(3, 46.0, 7.0, author="Ann Smith"),  # same photographer, but 111 km away: kept
        ref(4, 45.0, 7.0, author="Bob"),  # same spot, someone else: kept
        ref(5, -33.9, 18.4, author=""),  # no author on either side: kept
    ]
    far = (1 << 64) - 1  # 60 bits from the game photo's hash
    hashes = [None, 0b1111_0011, far, far, far, None]
    kept, dropped = leakage_filter(refs, hashes, game)
    assert kept == [3, 4, 5]
    assert dropped == {
        "same file as a game photo": 1,
        "near-duplicate of a game photo": 1,
        "same photographer near a game photo": 1,
    }


def test_leakage_guard_needs_a_hash_per_reference():
    with pytest.raises(ValueError):
        leakage_filter([ref(0, 1, 1)], [], [])


# --- shipping --------------------------------------------------------------------------------


def test_ships_only_when_the_whole_interval_is_below_zero():
    base = [500.0 + i for i in range(40)]
    assert ships([10.0] * 40, base).ships
    same = ships(base, base)
    assert not same.ships and same.median_km_delta == 0
    # Better on half the photos, much worse on the other half: not a clear win.
    mixed = [0.0 if i % 2 else 2000.0 for i in range(40)]
    assert not ships(mixed, base).ships


def italy(n=30):
    """`n` photos around Italy, each with a reference photo taken at the same spot that looks
    like it, and Atlas v0 always pinning Rome."""
    rng = np.random.default_rng(0)
    lats = rng.uniform(37.5, 46.5, n)
    lons = rng.uniform(8.0, 16.0, n)
    photos = [
        Photo(f"p{i}", LatLon(float(a), float(o)), f"Spot {i}", country="IT")
        for i, (a, o) in enumerate(zip(lats, lons, strict=True))
    ]
    base_guesses = [guess(41.9, 12.5) for _ in photos]
    base = System("v0", predictions_from_guesses(photos, base_guesses), base_guesses)
    queries = [onehot(i, n) for i in range(n)]
    refs = [ref(i, p.location.lat, p.location.lon, place=f"Near {i}") for i, p in enumerate(photos)]
    return photos, base, queries, refs


def test_a_refinement_that_clearly_wins_plays_in_the_game():
    photos, base, queries, refs = italy()
    index = ReferenceIndex(refs, np.stack(queries), k=1)
    refined, record = refine_with_references(photos, base, queries, index, model="Fake/test")
    assert refined.guesses is not None
    assert refined.name == "v0, then nearest reference photos"
    assert record["ships"] and record["moved"] == len(photos)
    assert record["ci95"][1] < 0 and record["versus"] == "v0"
    assert refined.guesses[3].city == "Near 3"

    atlas, report, markdown = build_outputs(
        photos, [base, refined], retrieval=record, now="2026-10-22T00:00:00+00:00"
    )
    assert atlas["model"] == refined.name
    assert atlas["guesses"]["p3"]["guessedPlace"] == "Near 3, IT"
    assert atlas["evaluation"]["retrieval"]["ships"] is True
    assert report["retrieval"] == record
    assert "| yes |" in markdown


def test_a_refinement_that_does_not_win_is_reported_but_never_plays():
    photos, base, queries, refs = italy()
    # Shuffle which reference looks like which photo: the look-alikes now point anywhere.
    shuffled = [refs[(i + 7) % len(refs)] for i in range(len(refs))]
    index = ReferenceIndex(shuffled, np.stack(queries), k=1)
    refined, record = refine_with_references(photos, base, queries, index, model="Fake/test")
    assert refined.guesses is None and not record["ships"]

    atlas, report, markdown = build_outputs(
        photos, [base, refined], retrieval=record, now="2026-10-22T00:00:00+00:00"
    )
    assert atlas["model"] == "v0"
    playing = [s for s in atlas["evaluation"]["systems"] if s["playsInGame"]]
    assert [s["name"] for s in playing] == ["v0"]
    assert any(s["name"] == refined.name for s in atlas["evaluation"]["systems"])
    assert "| no |" in markdown
    json.dumps(atlas)  # the game reads it as JSON


def test_references_load_from_csv(tmp_path):
    path = tmp_path / "references.csv"
    path.write_text(
        "id,title,lat,lon,country,place,author,license,source_url,thumb_url\n"
        'wr1,File:A.jpg,45.1,7.6,it,Turin,"A, B",CC BY 4.0,https://c/A,https://t/A\n'
    )
    assert load_references(path) == [
        Reference("wr1", 45.1, 7.6, "IT", "Turin", "A, B", "https://c/A")
    ]
