import { beforeEach, describe, expect, it } from "vitest";

import { haversineKm, scoreDistance, type LngLat } from "@/lib/geo";

import {
  BEST_HOT_KEY,
  MAX_PINS,
  PIN_BONUS,
  atlasTotal,
  hotAtlas,
  hotAtlasLine,
  hotClue,
  hotPin,
  hotReducer,
  hotRound,
  hotTotal,
  initialHot,
  loadBestHot,
  rememberHot,
  type HotAtlas,
  type HotState,
} from "./hotCold";

const PARIS = { lng: 2.35, lat: 48.86 };
const BERLIN = { lng: 13.4, lat: 52.52 };
const MADRID = { lng: -3.7, lat: 40.42 };
const TOKYO = { lng: 139.69, lat: 35.69 };

function drop(state: HotState, at: LngLat, truth: LngLat, found = false, atlas?: HotAtlas) {
  const pinned = hotReducer(state, { type: "pinned", pin: at });
  return hotReducer(pinned, { type: "dropped", truth, found, atlas: atlas ?? null });
}

const started = hotReducer(initialHot, { type: "start", order: ["a", "b"] });

beforeEach(() => localStorage.clear());

describe("clues", () => {
  it("says how far off and which way, by the great-circle heading", () => {
    const clue = hotClue([hotPin(PARIS, TOKYO, false)])!;
    expect(clue.km).toBeCloseTo(haversineKm(PARIS, TOKYO));
    // Paris to Tokyo sets off north-east on the great circle, not east.
    expect(clue.heading).toBe("north-east");
    expect(clue.trend).toBeNull();
  });

  it("calls the second pin warmer or colder than the first, and a tie colder", () => {
    const far = hotPin(MADRID, BERLIN, false);
    const near = hotPin(PARIS, BERLIN, false);
    expect(hotClue([far, near])!.trend).toBe("warmer");
    expect(hotClue([near, far])!.trend).toBe("colder");
    expect(hotClue([near, near])!.trend).toBe("colder");
  });

  it("gives no clue before a pin has missed", () => {
    expect(hotClue([])).toBeNull();
  });
});

describe("a photo's score", () => {
  it("is the closest pin's points plus the bonus for the pin that found the country", () => {
    const pins = [hotPin(TOKYO, PARIS, false), hotPin(BERLIN, PARIS, true)];
    const round = hotRound("a", pins, null);
    expect(round.foundOn).toBe(2);
    expect(round.bonus).toBe(PIN_BONUS[1]);
    expect(round.score).toBe(scoreDistance(pins[1]!.km) + PIN_BONUS[1]);
  });

  it("keeps an early near miss over a later pin that found the country further away", () => {
    const near = hotPin(BERLIN, PARIS, false);
    const found = hotPin(TOKYO, PARIS, true);
    const round = hotRound("a", [near, found], null);
    expect(round.bestKm).toBeCloseTo(near.km);
    expect(round.closest).toBe(scoreDistance(near.km));
  });

  it("gives no bonus when no pin found the country", () => {
    const pins = [hotPin(TOKYO, PARIS, false), hotPin(MADRID, PARIS, false)];
    const round = hotRound("a", pins, null);
    expect(round.foundOn).toBeNull();
    expect(round.score).toBe(round.closest);
  });

  it("scores Atlas's one pin by the same rules", () => {
    expect(hotAtlas(100, true).score).toBe(scoreDistance(100) + PIN_BONUS[0]);
    expect(hotAtlas(100, false).score).toBe(scoreDistance(100));
  });
});

describe("the game", () => {
  it("needs a pin before one can drop", () => {
    const state = hotReducer(started, { type: "dropped", truth: PARIS, found: true, atlas: null });
    expect(state).toBe(started);
  });

  it("ends the photo on the pin that finds the country", () => {
    const state = drop(started, BERLIN, PARIS, true);
    expect(state.phase).toBe("answered");
    if (state.phase === "answered") expect(state.round.foundOn).toBe(1);
  });

  it("keeps a miss and clears the pin, until the last pin ends the photo", () => {
    let state: HotState = started;
    for (let n = 1; n < MAX_PINS; n++) {
      state = drop(state, TOKYO, PARIS);
      expect(state.phase).toBe("guessing");
      if (state.phase === "guessing") {
        expect(state.pins).toHaveLength(n);
        expect(state.pin).toBeNull();
      }
    }
    const atlas = hotAtlas(10, true);
    state = drop(state, TOKYO, PARIS, false, atlas);
    expect(state.phase).toBe("answered");
    if (state.phase === "answered") {
      expect(state.round.pins).toHaveLength(MAX_PINS);
      expect(state.round.foundOn).toBeNull();
      expect(state.round.atlas).toBe(atlas);
    }
  });

  it("starts the next photo with no pins, and finishes after the last", () => {
    let state = hotReducer(drop(started, BERLIN, PARIS, true), { type: "next" });
    expect(state).toMatchObject({ phase: "guessing", index: 1, pins: [], pin: null });
    state = hotReducer(drop(state, BERLIN, PARIS, true), { type: "next" });
    expect(state.phase).toBe("finished");
    if (state.phase === "finished") expect(state.results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("finishes at once with nothing to deal", () => {
    expect(hotReducer(initialHot, { type: "start", order: [] }).phase).toBe("finished");
  });
});

describe("the totals", () => {
  const pin = hotPin(BERLIN, PARIS, true);
  const you = hotRound("a", [pin], hotAtlas(pin.km, false));
  const sat = hotRound("b", [pin], null);

  it("adds up the photos, Atlas's over those it played", () => {
    expect(hotTotal([you, sat])).toBe(you.score * 2);
    expect(atlasTotal([you, sat])).toEqual({ total: you.atlas!.score, played: 1 });
  });

  it("says who won over a whole game, and only then", () => {
    expect(hotAtlasLine([you])).toMatch(
      /^Atlas scored .+ with one pin a photo\. You beat it by 1,000\.$/,
    );
    const ahead = hotRound("a", [hotPin(TOKYO, PARIS, false)], hotAtlas(0, true));
    expect(hotAtlasLine([ahead])).toMatch(/, [\d,]+ ahead of you\.$/);
    const level = hotRound("a", [pin], hotAtlas(pin.km, true));
    expect(hotAtlasLine([level])).toMatch(/: level with you\.$/);
    expect(hotAtlasLine([you, sat])).toMatch(/on the 1 of 2 photos it played\.$/);
    expect(hotAtlasLine([sat])).toBeNull();
  });
});

describe("the best", () => {
  it("keeps only a better game, and survives junk", () => {
    expect(loadBestHot()).toBe(0);
    expect(rememberHot(9000)).toBe(9000);
    expect(rememberHot(4000)).toBe(9000);
    expect(loadBestHot()).toBe(9000);
    localStorage.setItem(BEST_HOT_KEY, "soup");
    expect(loadBestHot()).toBe(0);
  });
});
