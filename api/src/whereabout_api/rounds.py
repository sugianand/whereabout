"""Round lifecycle: start a round, accept exactly one guess, reveal the answer.

In-memory for Milestone 1; replaced by PostgreSQL in Milestone 7 behind the same interface.
"""

from __future__ import annotations

import random
import threading
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from whereabout_api.geo import MAX_HINTS, LatLon, haversine_km, score_distance
from whereabout_api.photos import Photo


class RoundNotFound(KeyError):
    pass


class RoundAlreadyGuessed(Exception):
    pass


class NoHintsLeft(Exception):
    pass


class HintsMismatch(Exception):
    """The guess claims a different number of hints than this round was given."""


@dataclass(slots=True)
class Round:
    id: str
    photo: Photo
    guess: LatLon | None = None
    distance_km: float | None = None
    score: int | None = None
    # Hints given so far; the server counts them, so a guess can't claim fewer.
    hints_used: int = 0


@dataclass(frozen=True, slots=True)
class GuessResult:
    round: Round
    distance_km: float
    score: int
    hints_used: int


class RoundStore:
    def __init__(
        self,
        photos: Sequence[Photo],
        choose: Callable[[Sequence[Photo]], Photo] = random.choice,
    ) -> None:
        if not photos:
            raise ValueError("photo catalog is empty")
        self._photos = tuple(photos)
        self._choose = choose
        self._rounds: dict[str, Round] = {}
        self._lock = threading.Lock()

    def start(self) -> Round:
        rnd = Round(id=uuid.uuid4().hex, photo=self._choose(self._photos))
        with self._lock:
            self._rounds[rnd.id] = rnd
        return rnd

    def get(self, round_id: str) -> Round:
        try:
            return self._rounds[round_id]
        except KeyError as exc:
            raise RoundNotFound(round_id) from exc

    def take_hint(self, round_id: str, available: int) -> int:
        """Give the round's next hint, of `available`, and return how many it has had."""
        with self._lock:
            rnd = self.get(round_id)
            if rnd.guess is not None:
                raise RoundAlreadyGuessed(round_id)
            if rnd.hints_used >= min(available, MAX_HINTS):
                raise NoHintsLeft(round_id)
            rnd.hints_used += 1
            return rnd.hints_used

    def guess(self, round_id: str, guess: LatLon, hints_used: int | None = None) -> GuessResult:
        """Score a guess. `hints_used`, when the client sends it, must match the server's count."""
        with self._lock:
            rnd = self.get(round_id)
            if rnd.guess is not None:
                raise RoundAlreadyGuessed(round_id)
            if hints_used is not None and hints_used != rnd.hints_used:
                raise HintsMismatch(round_id)
            distance = haversine_km(guess, rnd.photo.location)
            rnd.guess = guess
            rnd.distance_km = distance
            rnd.score = score_distance(distance, rnd.hints_used)
            return GuessResult(
                round=rnd, distance_km=distance, score=rnd.score, hints_used=rnd.hints_used
            )
