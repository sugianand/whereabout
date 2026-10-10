"""Human-readable "clues": zero-shot concept scores shown to players at the reveal.

Each group is a set of mutually exclusive descriptions of the scene. The model's softmax over a
group says which description fits best; a clue is shown only when the best option clearly wins.
These are what Atlas v0 can honestly report about a photo. Trained concept heads, with labels
derived from maps, replace them in Atlas v1 (docs/architecture.md).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ConceptGroup:
    name: str
    # (label shown to players, prompt given to the model)
    options: tuple[tuple[str, str], ...]


CONCEPT_GROUPS: tuple[ConceptGroup, ...] = (
    ConceptGroup(
        "climate",
        (
            ("Tropical", "a photo of a tropical place with lush vegetation"),
            ("Desert", "a photo of a dry desert landscape"),
            ("Snow and ice", "a photo of a snowy, icy landscape"),
            ("Temperate", "a photo of a green temperate landscape"),
            ("Mediterranean", "a photo of a sunny Mediterranean landscape"),
            ("Arctic", "a photo of arctic tundra"),
        ),
    ),
    ConceptGroup(
        "setting",
        (
            ("City", "a photo of a big city"),
            ("Village", "a photo of a small village"),
            ("Coast", "a photo of a coastline by the sea"),
            ("Mountains", "a photo of high mountains"),
            ("Countryside", "a photo of open countryside"),
        ),
    ),
    ConceptGroup(
        "architecture",
        (
            ("European old town", "a photo of European historic architecture"),
            ("East Asian architecture", "a photo of East Asian traditional architecture"),
            ("Islamic architecture", "a photo of Islamic architecture"),
            ("Colonial architecture", "a photo of Spanish colonial architecture"),
            ("Modern skyline", "a photo of modern skyscrapers"),
            ("No buildings", "a photo of nature with no buildings"),
        ),
    ),
)

# A clue is shown only when it clearly wins its group (a tie between two options is not a clue).
MIN_CLUE_PROBABILITY = 0.55
