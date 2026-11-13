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
in both. The globe stages' panels (`.wb-stage`) and the photo tiles of the quick games
(`.wb-night`) keep the night chart in either theme, because words over a photo need a dark scrim.

### The globe by day

The game's globe (`web/src/components/Globe.tsx`, in the five-round game, Survival, Country
Streak, Hot and cold and pass and play) follows the page: on a light page MapLibre paints it as a
daylight chart (`GLOBE_PALETTES.day` in `web/src/lib/basemap.ts`), and a change of theme, from
the Colours switch or the device, repaints it in place mid-game without losing the pin or the
reveal. Your map's globe and the results screen's tour follow it the same way
(`PlayedMap.tsx`, `GameTour.tsx`): a switch repaints them in place, so the tour keeps flying and
the marks stay put.

| Role | Night | Day |
| --- | --- | --- |
| sea | `#0D3346` | `#A9CFDC` |
| land | `#16495E` | `#F3EEDD` |
| borders | `#2A5B6E` | `#8A9EA4` |
| graticule | `#2A5B6E` | `#7FA9B8` |
| sky | `#061A24` | `#F4F7F6` |
| player (flare) | `#FF5D8F` | `#8A002F` |
| Atlas (sonar) | `#4FE3C1` | `#004A6E` |
| answer (gold) | `#FFC53D` | `#876508` |

The three marks (pins, arcs, Country Streak's countries, Atlas's heatmap) keep 3:1 against both
the sea and the land, and each pair stays at least 0.10 apart in OKLab under simulated
protanopia, deuteranopia and tritanopia (`basemap.test.ts`). The page's daylight accents were too
close to each other once darkened for a mid-blue sea (Atlas's teal and the answer's gold met
without red vision), so the globe has its own three, and the pins drawn over it take them through
`.globe[data-light="day"]` in `globals.css`.

Your map's four closeness bands get a daylight set of their own, drawn with a pale edge in place
of the night's dark one, on the globe and in its legend and list:

| Band | Night | Day |
| --- | --- | --- |
| bullseye | `#FFC53D` | `#8D5E03` |
| close | `#4FE3C1` | `#0F7787` |
| near | `#FF5D8F` | `#850028` |
| far | `#8F9BFF` | `#2514A4` |

Each keeps 3:1 against the day sea, the day land, its edge and the light page, and every pair
stays at least 0.10 apart in OKLab for typical vision and all three simulated dichromacies
(`PlayedMap.test.tsx`).

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
