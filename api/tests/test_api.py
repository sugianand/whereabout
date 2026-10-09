from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from whereabout_api.geo import MAX_POINTS, LatLon
from whereabout_api.main import create_app
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


@pytest.fixture
def client() -> TestClient:
    store = RoundStore([KYOTO], choose=lambda photos: photos[0])
    return TestClient(create_app(store, SETTINGS))


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
