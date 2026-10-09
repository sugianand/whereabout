# Design system

The game itself is the homepage: a visitor lands on round one, not on a marketing page.
The photo is always the hero; everything else stays quiet until the reveal.

## Direction: a nautical chart at night

Players are navigators reading clues off a photo. The palette is a night chart (deep ocean,
pale chalk lines) lit by three signal colors, one per actor in the game. Each color means one
thing everywhere: on pins, arcs, distances and score bars.

| Token | Hex | Meaning |
| --- | --- | --- |
| `ocean` | `#0D3346` | Page background, the sea on the globe |
| `ocean-deep` | `#082331` | Panels and the photo frame |
| `graticule` | `#2A5B6E` | Grid lines, borders, quiet structure |
| `chalk` | `#EEF4F2` | Text |
| `flare` | `#FF5D8F` | The player: your pin, your arc, your score |
| `sonar` | `#4FE3C1` | Atlas, the AI: its pin, its arc, its score |
| `gold` | `#FFC53D` | The true location |

## Type

- **Big Shoulders Display**, a condensed face drawn from city wayfinding signs, for place
  names, distances and scores. Road signs are a real geolocation clue, so the type is part of
  the theme. Numbers use tabular figures so count-ups don't jitter.
- **Atkinson Hyperlegible Next** for everything else. It was designed for readers with low
  vision, which suits a game meant for 12-year-olds and 60-year-olds alike.

## Layout

```
┌──────────────────────────────────────────────┐
│ Whereabout                     Round 2 of 5  │
│ ┌──────────────────────────────────────────┐ │
│ │                                          │ │
│ │               the photo                  │ │
│ │                              ┌─────────┐ │ │
│ │                              │  globe  │ │ │
│ │                              │ (expands│ │ │
│ │                              │ on tap) │ │ │
│ │                              └─────────┘ │ │
│ └──────────────────────────────────────────┘ │
│              [ Guess here ]                  │
└──────────────────────────────────────────────┘
```

On phones the globe becomes a bottom sheet with the photo above it.

## Principles

- One orchestrated moment: the reveal (pins drop, arcs draw, distances count up). No
  decorative entrance animations elsewhere.
- Copy is plain and specific: "Place your pin", "Guess here", "Next photo".
- Respect `prefers-reduced-motion`: the reveal jumps straight to its final state.
- Visible keyboard focus everywhere; the globe can be operated without a mouse.
