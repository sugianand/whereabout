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

### The chart by day

The site follows the device's light or dark setting, and the Games menu's *Colours* switch (Auto,
Light, Dark) holds one, kept in this browser under `whereabout:theme` (`web/src/lib/theme.ts`).
A script in the page's `<head>` applies the kept choice before the first paint. The daylight set
keeps every token's role; the accents darken so they read as text on a pale page, and words on
an accent turn pale with them:

| Token | Night | Day |
| --- | --- | --- |
| `ocean` | `#0D3346` | `#E9F0EE` |
| `ocean-deep` | `#082331` | `#FBFCFB` |
| `graticule` | `#2A5B6E` | `#7D9AA3` |
| `chalk` | `#EEF4F2` | `#0D2B38` |
| `chalk-dim` | `#A9C2C8` | `#405D68` |
| `flare` | `#FF5D8F` | `#A80C45` |
| `sonar` | `#4FE3C1` | `#006454` |
| `gold` | `#FFC53D` | `#7A4E00` |

Every text pairing keeps 4.5:1 in daylight (`theme.test.ts`), and the axe audit runs every screen
in both. The globe, the globe stages (`.wb-stage`) and the photo tiles of the quick games
(`.wb-night`) keep the night chart in either theme: MapLibre paints the globe in literal night
colours, and words over a photo need a dark scrim.

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

## The globe

- MapLibre GL in globe projection. The sea is `ocean`, land a lighter teal, borders and a 30°
  graticule in `graticule`. No place labels: a labelled map would give the answer away.
- The basemap is bundled (Natural Earth 1:110m, public domain), so the globe needs no tile
  server or API key and works offline.
- The player's pin is a `flare` drop. Clicking again moves it; there is only ever one.
- Keyboard: Enter drops a pin at the centre of the view, arrow keys move it 1° (Shift: 10°)
  and the camera follows, + and - zoom. The pin's coordinates are announced in a live region.

## Principles

- One orchestrated moment: the reveal (pins drop, arcs draw, distances count up). No
  decorative entrance animations elsewhere.
- Copy is plain and specific: "Place your pin", "Guess here", "Next photo".
- Respect `prefers-reduced-motion`: the reveal jumps straight to its final state.
- Visible keyboard focus everywhere; the globe can be operated without a mouse.
