from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from whereabout_api.atlas import parse_guess
from whereabout_api.catalog import load_catalog
from whereabout_api.geo import MAX_POINTS, LatLon, haversine_km, score_distance
from whereabout_api.main import create_app, playable
from whereabout_api.photos import Photo
from whereabout_api.rounds import RoundStore
from whereabout_api.settings import Settings

KYOTO = Photo(
    "test-kyoto",
    LatLon(35.0116, 135.7681),
    "Kyoto, Japan",
    image_url="https://example.org/kyoto.jpg",
    attribution="Ann Example",
    license="CC BY-SA 4.0",
    country="JP",
    source_url="https://example.org/File:Kyoto_temple.jpg",
)
SETTINGS = Settings(catalog_path=Path("unused.csv"), cors_origins=("http://localhost:3000",))


OSAKA_GUESS = parse_guess(
    "test-kyoto",
    {
        "lat": 34.6937,
        "lng": 135.5023,
        "confidence": 0.7,
        "guessedPlace": "Osaka, JP",
        "topCountries": [{"country": "JP", "p": 0.7}],
        "clues": [{"label": "Temple", "p": 0.88}],
        "belief": {"JP": 0.7, "KR": 0.05},
    },
)


@pytest.fixture
def client() -> TestClient:
    store = RoundStore([KYOTO], choose=lambda photos: photos[0])
    return TestClient(create_app(store, SETTINGS, atlas={}))


@pytest.fixture
def client_with_atlas() -> TestClient:
    store = RoundStore([KYOTO], choose=lambda photos: photos[0])
    return TestClient(create_app(store, SETTINGS, atlas={"test-kyoto": OSAKA_GUESS}))


def start_round(client: TestClient) -> dict:
    resp = client.post("/api/v1/rounds")
    assert resp.status_code == 201
    return resp.json()


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_starting_a_round_does_not_leak_the_answer(client):
    body = start_round(client)
    assert body["photo"]["id"] == "test-kyoto"
    assert body["photo"] == {"id": "test-kyoto", "image_url": "https://example.org/kyoto.jpg"}
    flat = str(body)
    assert "35.0116" not in flat and "Kyoto" not in flat and "Ann Example" not in flat


def test_perfect_guess(client):
    rid = start_round(client)["round_id"]
    resp = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 35.0116, "lon": 135.7681})
    assert resp.status_code == 200
    body = resp.json()
    assert body["distance_km"] == 0
    assert body["score"] == MAX_POINTS
    assert body["answer"]["place_name"] == "Kyoto, Japan"
    assert body["answer"]["country"] == "JP"
    assert body["answer"]["credit"] == {
        "author": "Ann Example",
        "license": "CC BY-SA 4.0",
        "source_url": "https://example.org/File:Kyoto_temple.jpg",
    }


def test_atlas_sits_out_photos_it_has_no_guess_for(client):
    rid = start_round(client)["round_id"]
    body = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 0, "lon": 0}).json()
    assert body["atlas"] is None


def test_atlas_guess_is_scored_server_side_and_revealed_only_after_the_guess(client_with_atlas):
    started = start_round(client_with_atlas)
    assert "atlas" not in started and "Osaka" not in str(started)

    rid = started["round_id"]
    body = client_with_atlas.post(
        f"/api/v1/rounds/{rid}/guess", json={"lat": 35.0116, "lon": 135.7681}
    ).json()
    atlas = body["atlas"]
    # Osaka is ~43 km from Kyoto: the same haversine and points that score the player.
    expected_km = haversine_km(OSAKA_GUESS.location, KYOTO.location)
    assert atlas["distance_km"] == pytest.approx(expected_km, abs=1e-3)
    assert 40 < atlas["distance_km"] < 46
    assert atlas["score"] == score_distance(expected_km)
    assert atlas["score"] < body["score"] == MAX_POINTS
    assert atlas["guessed_place"] == "Osaka, JP"
    assert atlas["top_countries"] == [{"country": "JP", "p": 0.7}]
    assert atlas["clues"] == [{"label": "Temple", "p": 0.88}]
    assert atlas["belief"] == {"JP": 0.7, "KR": 0.05}


def test_far_guess_scores_less(client):
    rid = start_round(client)["round_id"]
    body = client.post(f"/api/v1/rounds/{rid}/guess", json={"lat": 48.8566, "lon": 2.3522}).json()
    assert body["distance_km"] > 9000
    assert body["score"] < 100


def test_second_guess_is_rejected(client):
    rid = start_round(client)["round_id"]
    guess = {"lat": 0, "lon": 0}
    assert client.post(f"/api/v1/rounds/{rid}/guess", json=guess).status_code == 200
    assert client.post(f"/api/v1/rounds/{rid}/guess", json=guess).status_code == 409


def test_unknown_round_is_404(client):
    resp = client.post("/api/v1/rounds/nope/guess", json={"lat": 0, "lon": 0})
    assert resp.status_code == 404


@pytest.mark.parametrize("payload", [{"lat": 91, "lon": 0}, {"lat": 0, "lon": -181}, {"lat": 0}])
def test_invalid_guess_is_422(client, payload):
    rid = start_round(client)["round_id"]
    assert client.post(f"/api/v1/rounds/{rid}/guess", json=payload).status_code == 422


def test_cors_allows_the_configured_web_origin(client):
    resp = client.options(
        "/api/v1/rounds",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_rejects_other_origins(client):
    resp = client.options(
        "/api/v1/rounds",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in resp.headers


def test_default_app_serves_the_real_catalog():
    app_client = TestClient(create_app(settings=Settings.from_env({})))
    body = app_client.post("/api/v1/rounds").json()
    assert body["photo"]["image_url"].startswith("https://")


def test_rounds_are_dealt_only_from_photos_atlas_has_guessed():
    # The real catalog, but Atlas has guessed one photo: the rest stand for photos just merged
    # from the Commons harvest, which wait until the Atlas workflow has guessed them.
    settings = Settings.from_env({})
    first = load_catalog(settings.catalog_path)[0]
    app_client = TestClient(create_app(settings=settings, atlas={first.id: OSAKA_GUESS}))
    for _ in range(20):
        body = app_client.post("/api/v1/rounds").json()
        assert body["photo"]["id"] == first.id


def test_playable_falls_back_to_every_photo_before_atlas_has_run():
    assert playable((KYOTO,), {}) == (KYOTO,)
    assert playable((KYOTO,), {"test-kyoto": OSAKA_GUESS}) == (KYOTO,)
    assert playable((KYOTO,), {"other": OSAKA_GUESS}) == (KYOTO,)
