"""FastAPI application.

The true location of a photo, and its credits (whose file names often name the place), are
never sent when a round starts; they are revealed only in the response to a guess
(see docs/decisions/0001-score-on-the-server.md). Hints are given and counted here too, so the
score a hinted guess earns is decided on the server.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from whereabout_api import __version__
from whereabout_api.atlas import AtlasGuess, load_atlas
from whereabout_api.catalog import load_catalog
from whereabout_api.geo import MAX_HINTS, LatLon, haversine_km, max_points, score_distance
from whereabout_api.hints import Clue, PhotoLabels, clues_for, load_labels
from whereabout_api.photos import Photo
from whereabout_api.rounds import (
    HintsMismatch,
    NoHintsLeft,
    RoundAlreadyGuessed,
    RoundNotFound,
    RoundStore,
)
from whereabout_api.settings import Settings


class PhotoOut(BaseModel):
    id: str
    image_url: str | None


class RoundOut(BaseModel):
    round_id: str
    photo: PhotoOut
    # How many hints this photo offers (0 to 3); what they say stays secret until asked for.
    hints_available: int


class HintOut(BaseModel):
    kind: str
    text: str


class HintsOut(BaseModel):
    round_id: str
    # Every hint given so far this round, in order; the newest is last.
    hints: list[HintOut]
    hints_left: int
    max_score: int


class GuessIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    # Hints the player took, as the client counted them. Optional; when sent it must match the
    # server's count, which is the one the score uses.
    hints_used: int | None = Field(default=None, ge=0, le=MAX_HINTS)


class CreditOut(BaseModel):
    author: str | None
    license: str | None
    source_url: str | None


class AnswerOut(BaseModel):
    lat: float
    lon: float
    place_name: str
    country: str | None
    credit: CreditOut


class CountryChanceOut(BaseModel):
    country: str
    p: float


class ClueOut(BaseModel):
    label: str
    p: float


class AtlasOut(BaseModel):
    """Atlas's precomputed guess for the same photo, scored against the same answer."""

    lat: float
    lon: float
    guessed_place: str | None
    confidence: float
    top_countries: list[CountryChanceOut]
    clues: list[ClueOut]
    # Country distribution for the reveal heatmap; None when atlas.json has none.
    belief: dict[str, float] | None = None
    distance_km: float
    score: int


class GuessOut(BaseModel):
    round_id: str
    distance_km: float
    score: int
    hints_used: int
    max_score: int
    answer: AnswerOut
    # None when Atlas has no guess for this photo (e.g. it was added after Atlas's last run).
    atlas: AtlasOut | None


def score_atlas(guess: AtlasGuess | None, truth: LatLon) -> AtlasOut | None:
    if guess is None:
        return None
    distance = haversine_km(guess.location, truth)
    return AtlasOut(
        lat=guess.location.lat,
        lon=guess.location.lon,
        guessed_place=guess.guessed_place,
        confidence=guess.confidence,
        top_countries=[CountryChanceOut(country=c, p=p) for c, p in guess.top_countries],
        clues=[ClueOut(label=c.label, p=c.p) for c in guess.clues],
        belief=dict(guess.belief) if guess.belief is not None else None,
        distance_km=round(distance, 3),
        score=score_distance(distance),
    )


def playable(photos: Sequence[Photo], atlas: Mapping[str, AtlasGuess]) -> tuple[Photo, ...]:
    """The photos rounds are dealt from: those Atlas has guessed, so every round is a match.

    Photos merged from the Commons harvest wait in the catalog until the Atlas workflow has
    guessed them. With no guesses at all, every photo plays (same rule as the web game,
    web/src/lib/game/playable.ts)."""
    guessed = tuple(p for p in photos if p.id in atlas)
    return guessed or tuple(photos)


def create_app(
    store: RoundStore | None = None,
    settings: Settings | None = None,
    atlas: dict[str, AtlasGuess] | None = None,
    labels: dict[str, PhotoLabels] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    atlas_guesses = load_atlas(settings.atlas_path) if atlas is None else atlas
    photo_labels = load_labels(settings.labels_path) if labels is None else labels

    def clues(photo: Photo) -> tuple[Clue, ...]:
        return clues_for(photo.country, photo_labels.get(photo.id))[:MAX_HINTS]

    rounds = store or RoundStore(playable(load_catalog(settings.catalog_path), atlas_guesses))

    app = FastAPI(title="Whereabout API", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/rounds", response_model=RoundOut, status_code=status.HTTP_201_CREATED)
    def start_round() -> RoundOut:
        rnd = rounds.start()
        return RoundOut(
            round_id=rnd.id,
            photo=PhotoOut(id=rnd.photo.id, image_url=rnd.photo.image_url),
            hints_available=len(clues(rnd.photo)),
        )

    @app.post("/api/v1/rounds/{round_id}/hints", response_model=HintsOut)
    def hint(round_id: str) -> HintsOut:
        try:
            available = clues(rounds.get(round_id).photo)
            used = rounds.take_hint(round_id, len(available))
        except RoundNotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "round not found") from None
        except RoundAlreadyGuessed:
            raise HTTPException(status.HTTP_409_CONFLICT, "round already guessed") from None
        except NoHintsLeft:
            raise HTTPException(status.HTTP_409_CONFLICT, "no hints left for this round") from None
        return HintsOut(
            round_id=round_id,
            hints=[HintOut(kind=c.kind, text=c.text) for c in available[:used]],
            hints_left=len(available) - used,
            max_score=max_points(used),
        )

    @app.post("/api/v1/rounds/{round_id}/guess", response_model=GuessOut)
    def guess(round_id: str, body: GuessIn) -> GuessOut:
        try:
            result = rounds.guess(round_id, LatLon(body.lat, body.lon), body.hints_used)
        except RoundNotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "round not found") from None
        except RoundAlreadyGuessed:
            raise HTTPException(status.HTTP_409_CONFLICT, "round already guessed") from None
        except HintsMismatch:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "hints used do not match the hints this round was given"
            ) from None

        truth = result.round.photo
        return GuessOut(
            round_id=round_id,
            distance_km=round(result.distance_km, 3),
            score=result.score,
            hints_used=result.hints_used,
            max_score=max_points(result.hints_used),
            answer=AnswerOut(
                lat=truth.location.lat,
                lon=truth.location.lon,
                place_name=truth.place_name,
                country=truth.country,
                credit=CreditOut(
                    author=truth.attribution, license=truth.license, source_url=truth.source_url
                ),
            ),
            atlas=score_atlas(atlas_guesses.get(truth.id), truth.location),
        )

    return app


app = create_app()
