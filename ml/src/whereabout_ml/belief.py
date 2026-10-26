"""Atlas's country distribution in the compact form the globe's heatmap shades.

Shared by the game's precomputed guesses (`run_atlas_v0`) and Pocket Atlas's index reference
(`pocket_index.locate`), and ported to the browser as `beliefFromProbabilities` in
web/src/lib/belief.ts, so every heatmap on the site keeps the same countries.
"""

from __future__ import annotations

from collections.abc import Sequence

# The heatmap keeps every country at or above this probability, rounded to BELIEF_DECIMALS.
BELIEF_MIN_P = 0.005
BELIEF_DECIMALS = 3


def belief_from_probabilities(
    codes: Sequence[str], probabilities: Sequence[float], min_p: float = BELIEF_MIN_P
) -> dict[str, float]:
    """Compact country distribution for the reveal heatmap: {ISO alpha-2: p}, largest first.

    Countries below `min_p` are dropped and the rest rounded to 3 decimals, so a photo costs
    a few hundred bytes. The values need not sum to 1 (the tail is left out). Ties keep the
    order of `codes`.
    """
    kept = [(c, float(p)) for c, p in zip(codes, probabilities, strict=True) if p >= min_p]
    kept.sort(key=lambda cp: -cp[1])
    return {c: round(p, BELIEF_DECIMALS) for c, p in kept}
