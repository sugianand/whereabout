"""FastAPI application.

The true location of a photo is never sent when a round starts; it is revealed only in the
response to a guess (see docs/decisions/0001-score-on-the-server.md).
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from whereabout_api import __version__
from whereabout_api.geo import LatLon
from whereabout_api.photos import DEV_PHOTOS
from whereabout_api.rounds import RoundAlreadyGuessed, RoundNotFound, RoundStore


class PhotoOut(BaseModel):
    id: str
    image_url: str | None
    attribution: str | None
    license: str | None


class RoundOut(BaseModel):
    round_id: str
    photo: PhotoOut


class GuessIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class AnswerOut(BaseModel):
    lat: float
    lon: float
    place_name: str


class GuessOut(BaseModel):
    round_id: str
    distance_km: float
    score: int
    answer: AnswerOut


def create_app(store: RoundStore | None = None) -> FastAPI:
    app = FastAPI(title="Whereabout API", version=__version__)
    rounds = store or RoundStore(DEV_PHOTOS)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/rounds", response_model=RoundOut, status_code=status.HTTP_201_CREATED)
    def start_round() -> RoundOut:
        rnd = rounds.start()
        p = rnd.photo
        return RoundOut(
            round_id=rnd.id,
            photo=PhotoOut(
                id=p.id, image_url=p.image_url, attribution=p.attribution, license=p.license
            ),
        )

    @app.post("/api/v1/rounds/{round_id}/guess", response_model=GuessOut)
    def guess(round_id: str, body: GuessIn) -> GuessOut:
        try:
            result = rounds.guess(round_id, LatLon(body.lat, body.lon))
        except RoundNotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "round not found") from None
        except RoundAlreadyGuessed:
            raise HTTPException(status.HTTP_409_CONFLICT, "round already guessed") from None

        truth = result.round.photo
        return GuessOut(
            round_id=round_id,
            distance_km=round(result.distance_km, 3),
            score=result.score,
            answer=AnswerOut(
                lat=truth.location.lat, lon=truth.location.lon, place_name=truth.place_name
            ),
        )

    return app


app = create_app()
