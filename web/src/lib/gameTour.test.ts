import { describe, expect, it } from "vitest";

import type { RoundResult } from "./game/state";
import { haversineKm, type LngLat } from "./geo";
import {
  TOUR_MAX_ZOOM,
  gameCamera,
  initialTour,
  stopCamera,
  tourLines,
  tourReducer,
  tourStops,
} from "./gameTour";
import { zoomForSpan } from "./reveal";

function round(truth: LngLat, pin: LngLat | null, atlas: LngLat | null, place = "Somewhere") {
  return {
    round: { roundId: place, photo: { id: place, imageUrl: "x" }, hintsAvailable: 0 },
    pin,
    clues: [],
    reveal: {
      roundId: place,
      distanceKm: pin ? haversineKm(pin, truth) : null,
      score: 0,
      hintsUsed: 0,
      answer: { ...truth, place, country: null, credit: null },
    },
    atlas: atlas
      ? {
          ...atlas,
          confidence: 0.5,
          topCountries: [],
          clues: [],
          distanceKm: haversineKm(atlas, truth),
          score: 0,
        }
      : null,
  } satisfies RoundResult;
}

const paris = { lng: 2.35, lat: 48.86 };
const berlin = { lng: 13.4, lat: 52.52 };
const tokyo = { lng: 139.69, lat: 35.69 };
const fiji = { lng: 178.4, lat: -18.1 };
const samoa = { lng: -171.8, lat: -13.8 };

describe("tourStops", () => {
  it("makes one stop per round with the player's and Atlas's guesses", () => {
    const stops = tourStops([round(paris, berlin, tokyo, "Paris"), round(tokyo, null, null)]);
    expect(stops).toHaveLength(2);
    expect(stops[0].place).toBe("Paris");
    expect(stops[0].view.guesses.map((g) => g.actor)).toEqual(["player", "atlas"]);
    expect(stops[0].playerKm).toBeCloseTo(haversineKm(berlin, paris));
    expect(stops[0].atlasKm).toBeCloseTo(haversineKm(tokyo, paris));
    // A Blitz round with no pin, on a photo Atlas sat out: just the answer.
    expect(stops[1].view.guesses).toEqual([]);
    expect(stops[1].playerKm).toBeNull();
    expect(stops[1].atlasKm).toBeNull();
  });
});

describe("stopCamera", () => {
  it("never zooms in past the tour's cap, even on a bullseye", () => {
    const [stop] = tourStops([round(paris, paris, null)]);
    expect(stopCamera(stop, 600).zoom).toBe(TOUR_MAX_ZOOM);
  });
});

describe("gameCamera", () => {
  it("centres a game across the antimeridian on the Pacific", () => {
    const stops = tourStops([round(fiji, samoa, null), round(samoa, fiji, null)]);
    const { center } = gameCamera(stops, 600);
    expect(Math.abs(center.lng)).toBeGreaterThan(170);
    expect(center.lat).toBeLessThan(-10);
  });

  it("zooms out further the further apart the game's places are", () => {
    const near = gameCamera(tourStops([round(paris, berlin, null)]), 600);
    const far = gameCamera(tourStops([round(paris, tokyo, null)]), 600);
    expect(far.zoom).toBeLessThan(near.zoom);
    expect(near.zoom).toBeLessThanOrEqual(TOUR_MAX_ZOOM);
  });

  it("frames the game's diameter on the reveal's zoom curve", () => {
    const stops = tourStops([round(paris, berlin, null)]);
    const { center, zoom } = gameCamera(stops, 600);
    const radius = Math.max(haversineKm(center, paris), haversineKm(center, berlin));
    expect(zoom).toBeCloseTo(Math.min(TOUR_MAX_ZOOM, zoomForSpan(radius * 2, 600)));
    // The centre lies between the two cities.
    expect(center.lng).toBeGreaterThan(paris.lng);
    expect(center.lng).toBeLessThan(berlin.lng);
  });

  it("falls back to the whole world for points that cancel out", () => {
    const a = { lng: 0, lat: 0 };
    const b = { lng: 180, lat: 0 };
    expect(gameCamera(tourStops([round(a, null, null), round(b, null, null)]), 600)).toEqual({
      center: { lng: 10, lat: 20 },
      zoom: 0,
    });
  });
});

describe("tourLines", () => {
  const stops = tourStops([
    round(paris, berlin, tokyo),
    round(tokyo, paris, null),
    round(berlin, null, null),
  ]);

  it("draws every arc of the rounds visited, tagged with its round", () => {
    const lines = tourLines(stops, 2);
    expect(lines.features.map((f) => [f.properties.round, f.properties.actor])).toEqual([
      [0, "player"],
      [0, "atlas"],
      [1, "player"],
    ]);
    const last = lines.features[2].geometry.coordinates.at(-1)!;
    expect(last[0]).toBeCloseTo(tokyo.lng);
    expect(last[1]).toBeCloseTo(tokyo.lat);
  });

  it("draws the round being flown to only part of the way", () => {
    const full = tourLines(stops, 2).features[2].geometry.coordinates.length;
    const half = tourLines(stops, 2, 1, 0.5).features[2].geometry.coordinates.length;
    expect(half).toBeLessThan(full);
    // Rounds already visited stay whole.
    expect(tourLines(stops, 2, 1, 0.5).features[0].geometry.coordinates.length).toBe(
      tourLines(stops, 2).features[0].geometry.coordinates.length,
    );
  });

  it("draws nothing for a round with no guesses", () => {
    expect(tourLines(stops, 3).features).toHaveLength(3);
  });
});

describe("the tour's state machine", () => {
  const reduce = tourReducer(3);

  it("starts on round one, or on the whole game without autoplay", () => {
    expect(initialTour(3, true)).toEqual({ at: 0, visited: 1, playing: true });
    expect(initialTour(3, false)).toEqual({ at: "all", visited: 3, playing: false });
    expect(initialTour(0, true)).toEqual({ at: "all", visited: 0, playing: false });
  });

  it("flies round by round, then pulls back to the whole game and stops", () => {
    let s = initialTour(3, true);
    s = reduce(s, { type: "advance" });
    expect(s).toEqual({ at: 1, visited: 2, playing: true });
    s = reduce(s, { type: "advance" });
    expect(s).toEqual({ at: 2, visited: 3, playing: true });
    s = reduce(s, { type: "advance" });
    expect(s).toEqual({ at: "all", visited: 3, playing: false });
    expect(reduce(s, { type: "advance" })).toBe(s);
  });

  it("stops touring when the player picks a round, showing every arc", () => {
    const s = reduce(initialTour(3, true), { type: "show", at: 2 });
    expect(s).toEqual({ at: 2, visited: 3, playing: false });
    // A stopped tour stays where the player put it.
    expect(reduce(s, { type: "advance" })).toBe(s);
    expect(reduce(s, { type: "show", at: 7 })).toBe(s);
    expect(reduce(s, { type: "show", at: "all" })).toEqual({
      at: "all",
      visited: 3,
      playing: false,
    });
  });

  it("flies through again from round one", () => {
    expect(reduce(initialTour(3, false), { type: "replay" })).toEqual(initialTour(3, true));
  });
});
