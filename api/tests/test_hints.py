import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from whereabout_api.geo import MAX_POINTS, LatLon, max_points, score_distance
from whereabout_api.hints import CONTINENT_OF, PhotoLabels, clues_for, load_labels
from whereabout_api.main import create_app
from whereabout_api.photos import Photo
from whereabout_api.rounds import RoundStore
from whereabout_api.settings import DEFAULT_CATALOG, DEFAULT_LABELS, Settings

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "data" / "fixtures" / "hint_cases.json").read_text()
)
SETTINGS = Settings(catalog_path=Path("unused.csv"), cors_origins=("http://localhost:3000",))

KYOTO = Photo("test-kyoto", LatLon(35.0116, 135.7681), "Kyoto, Japan", country="JP")
KYOTO_LABELS = {"test-kyoto": PhotoLabels(driving_side="left", climate_group="Temperate")}


def make_client(photo: Photo = KYOTO, labels=None) -> TestClient:
    store = RoundStore([photo], choose=lambda photos: photos[0])
    return TestClient(
        create_app(store, SETTINGS, atlas={}, labels=KYOTO_LABELS if labels is None else labels)
    )


def start(client: TestClient) -> dict:
    resp = client.post("/api/v1/rounds")
    assert resp.status_code == 201
    return resp.json()


# --- the shared rules (data/fixtures/hint_cases.json) ---


def test_each_hint_lowers_the_maximum_by_the_shared_table():
    assert [max_points(h) for h in range(4)] == FIXTURE["max_points_by_hints"]
    assert max_points(0) == MAX_POINTS
    with pytest.raises(ValueError):
        max_points(4)
    with pytest.raises(ValueError):
        max_points(-1)


@pytest.mark.parametrize(
    "case", FIXTURE["scores"], ids=lambda c: f"{c['distance_km']}km-{c['hints']}h"
)
def test_scores_with_hints_match_the_shared_fixture(case):
    assert score_distance(case["distance_km"], case["hints"]) == case["score"]


def test_a_hint_never_raises_a_score():
    for d in (0.0, 100.0, 2000.0, 15000.0):
        scores = [score_distance(d, h) for h in range(4)]
        assert scores == sorted(scores, reverse=True)


@pytest.mark.parametrize("case", FIXTURE["photos"], ids=lambda c: c["name"])
def test_clues_match_the_shared_fixture(case):
    labels = PhotoLabels(case["driving_side"], case["climate_group"])
    got = [{"kind": c.kind, "text": c.text} for c in clues_for(case["country"], labels)]
    assert got == case["clues"]


def test_continent_table_matches_the_web_table():
    assert dict(CONTINENT_OF) == FIXTURE["continents"]


def test_every_catalog_photo_offers_at_least_the_continent_hint():
    import csv

    with DEFAULT_CATALOG.open(newline="", encoding="utf-8") as fh:
        countries = {row["country"] for row in csv.DictReader(fh)}
    assert countries <= set(CONTINENT_OF)


def test_labels_load_from_the_real_concept_labels_file():
    labels = load_labels(DEFAULT_LABELS)
    assert labels, "data/labels/concept_labels.csv should have rows"
    assert {lab.driving_side for lab in labels.values()} <= {"left", "right", None}
    assert {lab.climate_group for lab in labels.values()} <= {
        "Tropical",
        "Arid",
        "Temperate",
        "Continental",
        "Polar",
        None,
    }


def test_missing_labels_file_means_no_label_hints(tmp_path):
    assert load_labels(tmp_path / "absent.csv") == {}


def test_empty_label_cells_give_no_hint(tmp_path):
    path = tmp_path / "labels.csv"
    path.write_text("id,climate,climate_group,land_cover,driving_side\nx1,,,,right\n")
    assert load_labels(path) == {"x1": PhotoLabels(driving_side="right", climate_group=None)}


# --- the API ---


def test_round_says_how_many_hints_it_offers_without_saying_what_they_are():
    body = start(make_client())
    assert body["hints_available"] == 3
    flat = json.dumps(body)
    assert "Asia" not in flat and "left" not in flat and "emperate" not in flat


def test_hints_come_one_at_a_time_in_order_and_lower_the_maximum():
    client = make_client()
    rid = start(client)["round_id"]
    first = client.post(f"/api/v1/rounds/{rid}/hints").json()
    assert first == {
        "round_id": rid,
        "hints": [{"kind": "continent", "text": "It's in Asia"}],
        "hints_left": 2,
        "max_score": 4000,
    }
    client.post(f"/api/v1/rounds/{rid}/hints")
    third = client.post(f"/api/v1/rounds/{rid}/hints").json()
    assert [h["kind"] for h in third["hints"]] == ["continent", "driving_side", "climate"]
    assert third["hints_left"] == 0 and third["max_score"] == 2000
    over = client.post(f"/api/v1/rounds/{rid}/hints")
    assert over.status_code == 409


def test_a_photo_without_labels_offers_only_the_continent():
    client = make_client(labels={})
    body = start(client)
    assert body["hints_available"] == 1
    rid = body["round_id"]
    assert client.post(f"/api/v1/rounds/{rid}/hints").json()["hints_left"] == 0
    assert client.post(f"/api/v1/rounds/{rid}/hints").status_code == 409


@pytest.mark.parametrize("hints", [0, 1, 2, 3])
def test_hinted_guess_is_scored_on_the_server(hints):
    client = make_client()
    rid = start(client)["round_id"]
    for _ in range(hints):
        client.post(f"/api/v1/rounds/{rid}/hints")
    osaka = {"lat": 34.6937, "lon": 135.5023}
    body = client.post(f"/api/v1/rounds/{rid}/guess", json=osaka).json()
    assert body["hints_used"] == hints
    assert body["max_score"] == FIXTURE["max_points_by_hints"][hints]
    assert body["score"] == score_distance(body["distance_km"], hints)


def test_the_same_hints_give_the_same_score_whether_or_not_the_client_counts_them():
    results = []
    for extra in ({}, {"hints_used": 2}):
        client = make_client()
        rid = start(client)["round_id"]
        client.post(f"/api/v1/rounds/{rid}/hints")
        client.post(f"/api/v1/rounds/{rid}/hints")
        resp = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 35.0, "lon": 135.0, **extra})
        results.append(resp.json())
    assert results[0]["score"] == results[1]["score"]
    assert results[0]["score"] == score_distance(results[0]["distance_km"], 2)


def test_claiming_fewer_hints_than_were_given_is_rejected():
    client = make_client()
    rid = start(client)["round_id"]
    client.post(f"/api/v1/rounds/{rid}/hints")
    resp = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 35, "lon": 135, "hints_used": 0})
    assert resp.status_code == 409
    # The round is still open: the honest count goes through.
    ok = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 35, "lon": 135, "hints_used": 1})
    assert ok.status_code == 200 and ok.json()["max_score"] == 4000


@pytest.mark.parametrize("hints_used", [-1, 4, "two"])
def test_invalid_hint_counts_are_422(hints_used):
    client = make_client()
    rid = start(client)["round_id"]
    resp = client.post(
        f"/api/v1/rounds/{rid}/guess", json={"lat": 35, "lon": 135, "hints_used": hints_used}
    )
    assert resp.status_code == 422


def test_no_hints_after_the_guess_or_for_unknown_rounds():
    client = make_client()
    rid = start(client)["round_id"]
    client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 35, "lon": 135})
    assert client.post(f"/api/v1/rounds/{rid}/hints").status_code == 409
    assert client.post("/api/v1/rounds/nope/hints").status_code == 404
