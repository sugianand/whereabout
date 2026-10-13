"""Scene gate: screen candidate game photos for things that make a bad round.

A good game photo is an outdoor scene with no people, no readable signs and no maps. CLIP can
check this zero-shot. For every reject reason ("people", "indoor", "text", "not_photo") we
write several prompts, encode and average them (prompt ensembling) and compare the photo with
that reason against an equally ensembled "good photo" prompt set. A reason's score is the
probability that the reason beats "good photo":

    score_r = softmax(logit_scale * [img . reject_r, img . accept])[0]

A photo is rejected for every reason whose score reaches its threshold. Thresholds are
calibrated on the hand-reviewed catalog (all known-good, so no catalog photo should be
rejected) and checked on a small labelled fixture of known rejects. No training happens.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np

from whereabout_ml.zeroshot import Encoder, normalise, softmax

REASONS = ("people", "indoor", "text", "not_photo")

REJECT_PROMPTS: dict[str, tuple[str, ...]] = {
    "people": (
        "a photo of a person",
        "a selfie",
        "a group of people posing",
        "a portrait of a face",
        "a crowd of tourists",
    ),
    "indoor": (
        "a photo of a room interior",
        "the inside of a building",
        "a photo of a living room",
        "the interior of a museum",
        "a photo taken indoors",
    ),
    "text": (
        "a photo of a road sign with the name of a town",
        "a close-up of a sign with writing",
        "a shop sign with readable text",
        "a street name sign",
        "a poster with lots of text",
    ),
    "not_photo": (
        "a map",
        "a drawing",
        "a painting",
        "a screenshot",
        "a diagram",
        "a scanned document",
    ),
}

ACCEPT_PROMPTS: tuple[str, ...] = (
    "a photo of an outdoor landscape",
    "a photo of an empty street with no people",
    "a photo of the countryside",
    "a photo of a coastline",
    "a photo of a city skyline",
    "a photo of mountains",
    "a photo of a village seen from a distance",
    "a photo of a river and fields",
)

# A placeholder until calibration (run_scene_gate) writes real thresholds.
DEFAULT_THRESHOLDS: dict[str, float] = {r: 0.5 for r in REASONS}

LOGIT_SCALE = 100.0


@dataclass(frozen=True, slots=True)
class Verdict:
    passed: bool
    reasons: tuple[str, ...]  # reasons whose score reached the threshold, in REASONS order
    scores: dict[str, float]


def _ensemble(encoder: Encoder, prompts: Sequence[str]) -> np.ndarray:
    """Encode prompts, normalise, average and re-normalise: one embedding per prompt set."""
    return normalise(np.mean(normalise(encoder.encode_texts(list(prompts))), axis=0))


class SceneGate:
    def __init__(
        self,
        encoder: Encoder,
        thresholds: Mapping[str, float] | None = None,
        logit_scale: float = LOGIT_SCALE,
    ) -> None:
        self.thresholds = dict(DEFAULT_THRESHOLDS if thresholds is None else thresholds)
        missing = [r for r in REASONS if r not in self.thresholds]
        if missing:
            raise ValueError(f"thresholds missing for {missing}")
        self.logit_scale = logit_scale
        self.reject_embeddings = {r: _ensemble(encoder, REJECT_PROMPTS[r]) for r in REASONS}
        self.accept_embedding = _ensemble(encoder, ACCEPT_PROMPTS)

    def score_embeddings(self, image_embs: np.ndarray) -> list[dict[str, float]]:
        images = normalise(np.atleast_2d(np.asarray(image_embs, dtype=np.float64)))
        out = []
        for image in images:
            accept = float(self.accept_embedding @ image)
            out.append(
                {
                    r: float(
                        softmax(
                            self.logit_scale
                            * np.array([float(self.reject_embeddings[r] @ image), accept])
                        )[0]
                    )
                    for r in REASONS
                }
            )
        return out

    def judge(self, scores: Mapping[str, float]) -> Verdict:
        reasons = tuple(r for r in REASONS if scores[r] >= self.thresholds[r])
        return Verdict(not reasons, reasons, dict(scores))

    def screen(self, image_embs: np.ndarray) -> list[Verdict]:
        return [self.judge(s) for s in self.score_embeddings(image_embs)]


def calibrate(
    keep_scores: Sequence[Mapping[str, float]], max_false_reject: float = 0.0
) -> dict[str, float]:
    """Per reason, the smallest threshold that rejects at most `max_false_reject` of keepers.

    A photo is rejected when its score is >= the threshold, so with 0.0 the threshold sits just
    above the highest keep score (rounded up to 3 decimals, capped at 1.0).
    """
    if not keep_scores:
        raise ValueError("calibrate needs at least one keep photo")
    if not 0 <= max_false_reject < 1:
        raise ValueError(f"max_false_reject must be in [0, 1), got {max_false_reject}")
    n = len(keep_scores)
    allowed = math.floor(max_false_reject * n + 1e-9)  # keepers we may reject
    out = {}
    for r in REASONS:
        ordered = sorted((s[r] for s in keep_scores), reverse=True)
        # Rejecting `allowed` keepers is fine: the threshold must exceed the (allowed+1)th highest.
        above = ordered[allowed]
        out[r] = min(1.0, round((math.floor(above * 1000 + 1e-9) + 1) / 1000, 3))
    return out


def evaluate(
    keep_scores: Sequence[Mapping[str, float]],
    rejects: Sequence[tuple[str, Mapping[str, float]]],
    thresholds: Mapping[str, float],
) -> dict:
    def reasons_for(scores: Mapping[str, float]) -> list[str]:
        return [r for r in REASONS if scores[r] >= thresholds[r]]

    rejected_by = dict.fromkeys(REASONS, 0)
    passed = 0
    for s in keep_scores:
        hit = reasons_for(s)
        passed += not hit
        for r in hit:
            rejected_by[r] += 1

    labels: dict[str, dict[str, int]] = {}
    for label, s in rejects:
        row = labels.setdefault(label, {"n": 0, "caught": 0, "caught_for_label": 0})
        hit = reasons_for(s)
        row["n"] += 1
        row["caught"] += bool(hit)
        row["caught_for_label"] += label in hit

    return {
        "thresholds": dict(thresholds),
        "catalog": {"n": len(keep_scores), "passed": passed, "rejected_by": rejected_by},
        "rejects": labels,
    }


def to_markdown(report: dict) -> str:
    cat = report["catalog"]
    lines = [
        "# Scene gate",
        "",
        f"Catalog photos passed: {cat['passed']} of {cat['n']}.",
        "",
        "| Reason | Threshold | Catalog photos rejected | Fixture n | Caught (any reason) "
        "| Caught (this reason) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in REASONS:
        fx = report["rejects"].get(r)
        n, caught, exact = (
            (fx["n"], fx["caught"], fx["caught_for_label"]) if fx else ("-", "-", "-")
        )
        lines.append(
            f"| {r} | {report['thresholds'][r]} | {cat['rejected_by'][r]} | {n} | {caught} "
            f"| {exact} |"
        )
    lines.append("")
    return "\n".join(lines)
