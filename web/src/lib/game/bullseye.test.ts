import { beforeEach, describe, expect, it } from "vitest";

import { circlePath, haversineKm, type LngLat } from "@/lib/geo";

import {
  ATLAS_RING_FROM,
  BEST_BULLSEYE_KEY,
  DEFAULT_RING,
  RINGS,
  atlasBet,
  atlasBullseyeTotal,
  atlasRing,
  bet,
  betLine,
  bullseyeAtlasLine,
  bullseyeReducer,
  bullseyeTotal,
  initialBullseye,
  loadBestBullseye,
  rememberBullseye,
  ringsHeld,
  type BullseyeState,
} from "./bullseye";

const PARIS = { lng: 2.35, lat: 48.86 };
const BERLIN = { lng: 13.4, lat: 52.52 };
const TOKYO = { lng: 139.69, lat: 35.69 };

beforeEach(() => localStorage.clear());

function play(
  state: BullseyeState,
  at: LngLat,
  ring: number,
  truth: LngLat,
  atlas: (LngLat & { confidence: number }) | null = null,
) {
  let s = bullseyeReducer(state, { type: "pinned", pin: at });
  s = bullseyeReducer(s, { type: "ring", ring });
  return bullseyeReducer(s, { type: "bet", truth, atlas });
}

describe("the rings", () => {
  it("pay less the wider they are, tightest first", () => {
    for (let i = 1; i < RINGS.length; i++) {
      expect(RINGS[i]!.km).toBeGreaterThan(RINGS[i - 1]!.km);
      expect(RINGS[i]!.points).toBeLessThan(RINGS[i - 1]!.points);
    }
  });

  it("score a photo inside the ring and nothing outside it", () => {
    // Paris to Berlin is about 878 km.
    expect(bet(PARIS, 0, BERLIN)).toMatchObject({ inside: false, score: 0 });
    expect(bet(PARIS, 1, BERLIN)).toMatchObject({ inside: false, score: 0 });
    expect(bet(PARIS, 2, BERLIN)).toMatchObject({ inside: true, score: RINGS[2]!.points });
    expect(bet(PARIS, 3, BERLIN)).toMatchObject({ inside: true, score: RINGS[3]!.points });
    expect(bet(PARIS, 2, BERLIN).km).toBeCloseTo(haversineKm(PARIS, BERLIN), 9);
  });

  it("count a photo on the ring's own line as inside", () => {
    const [lng, lat] = circlePath(PARIS, RINGS[0]!.km, 12)[3]!;
    expect(bet(PARIS, 0, { lng, lat }).inside).toBe(true);
  });

  it("refuse a ring that isn't one", () => {
    expect(() => bet(PARIS, RINGS.length, BERLIN)).toThrow(RangeError);
  });
});

describe("Atlas's ring", () => {
  it("tightens as Atlas grows surer of the country", () => {
    expect(atlasRing(0.95)).toBe(0);
    expect(atlasRing(ATLAS_RING_FROM[0])).toBe(0);
    expect(atlasRing(0.79)).toBe(1);
    expect(atlasRing(0.5)).toBe(1);
    expect(atlasRing(0.3)).toBe(2);
    expect(atlasRing(0.19)).toBe(3);
    expect(atlasRing(0)).toBe(3);
  });

  it("bets the widest ring on junk", () => {
    expect(atlasRing(Number.NaN)).toBe(RINGS.length - 1);
    expect(atlasRing(-0.5)).toBe(RINGS.length - 1);
  });

  it("bets from its own guess", () => {
    const b = atlasBet({ ...PARIS, confidence: 0.9 }, BERLIN);
    expect(b).toMatchObject({ at: PARIS, ring: 0, inside: false, score: 0 });
  });
});

describe("bullseyeReducer", () => {
  it("starts on the middle ring with no pin", () => {
    const s = bullseyeReducer(initialBullseye, { type: "start", order: ["a", "b"] });
    expect(s).toMatchObject({ phase: "guessing", index: 0, pin: null, ring: DEFAULT_RING });
  });

  it("finishes at once with nothing to deal", () => {
    expect(bullseyeReducer(initialBullseye, { type: "start", order: [] }).phase).toBe("finished");
  });

  it("won't bet without a pin, or take a ring that isn't one", () => {
    const s = bullseyeReducer(initialBullseye, { type: "start", order: ["a"] });
    expect(bullseyeReducer(s, { type: "bet", truth: PARIS, atlas: null })).toBe(s);
    expect(bullseyeReducer(s, { type: "ring", ring: 9 })).toBe(s);
    expect(bullseyeReducer(s, { type: "ring", ring: 1.5 })).toBe(s);
  });

  it("plays a game to the end, keeping the ring from photo to photo", () => {
    let s = bullseyeReducer(initialBullseye, { type: "start", order: ["a", "b"] });
    s = play(s, PARIS, 2, BERLIN, { ...TOKYO, confidence: 0.3 });
    expect(s.phase).toBe("answered");
    if (s.phase !== "answered") return;
    expect(s.round).toMatchObject({ id: "a", you: { inside: true, ring: 2 }, atlas: { ring: 2 } });
    expect(s.round.atlas!.inside).toBe(false);

    s = bullseyeReducer(s, { type: "next" });
    expect(s).toMatchObject({ phase: "guessing", index: 1, ring: 2, pin: null });
    // Pinning and changing the ring are dead once the photo is answered.
    s = play(s, BERLIN, 0, BERLIN);
    const answered = s;
    expect(bullseyeReducer(answered, { type: "ring", ring: 3 })).toBe(answered);
    expect(bullseyeReducer(answered, { type: "pinned", pin: TOKYO })).toBe(answered);

    s = bullseyeReducer(s, { type: "next" });
    expect(s.phase).toBe("finished");
    if (s.phase !== "finished") return;
    expect(bullseyeTotal(s.results)).toBe(RINGS[2]!.points + RINGS[0]!.points);
    expect(ringsHeld(s.results)).toBe(2);
    expect(atlasBullseyeTotal(s.results)).toEqual({ total: 0, played: 1, held: 0 });
  });

  it("picks a game back up at the first photo not bet on, on the ring last bet", () => {
    const first = { id: "a", you: bet(PARIS, 3, BERLIN), atlas: null };
    const s = bullseyeReducer(initialBullseye, {
      type: "start",
      order: ["a", "b", "c"],
      from: [first],
    });
    expect(s).toMatchObject({ phase: "guessing", index: 1, ring: 3, pin: null, results: [first] });
  });

  it("starts a game with every photo bet on already finished", () => {
    const from = ["a", "b"].map((id) => ({ id, you: bet(PARIS, 0, PARIS), atlas: null }));
    const s = bullseyeReducer(initialBullseye, { type: "start", order: ["a", "b"], from });
    expect(s).toEqual({ phase: "finished", order: ["a", "b"], results: from });
  });
});

describe("the words", () => {
  it("say where the photo fell against the ring, in the player's units", () => {
    expect(betLine(bet(PARIS, 2, BERLIN), "km")).toMatch(
      /^Inside the 2,000 km ring, 87\d km off: 250 points\.$/,
    );
    expect(betLine(bet(PARIS, 0, BERLIN), "mi")).toMatch(
      /^Outside the 155 mi ring, 54\d mi off: no points\.$/,
    );
  });

  it("call the game against Atlas only over every photo", () => {
    let s = bullseyeReducer(initialBullseye, { type: "start", order: ["a", "b"] });
    s = play(s, PARIS, 0, PARIS, { ...PARIS, confidence: 0.6 });
    s = bullseyeReducer(s, { type: "next" });
    s = play(s, PARIS, 0, TOKYO, null);
    if (s.phase !== "answered") throw new Error("not answered");
    expect(bullseyeAtlasLine(s.results)).toBe(
      "Atlas scored 500 on the 1 of 2 photos it played, holding 1 of 1 ring.",
    );
    expect(bullseyeAtlasLine(s.results.slice(0, 1))).toBe(
      "Atlas scored 500, holding 1 of 1 ring. You beat it by 500.",
    );
    expect(bullseyeAtlasLine(s.results.slice(1))).toBeNull();
  });

  it("say when Atlas is ahead or level", () => {
    let s = bullseyeReducer(initialBullseye, { type: "start", order: ["a"] });
    s = play(s, PARIS, 3, PARIS, { ...PARIS, confidence: 0.9 });
    if (s.phase !== "answered") throw new Error("not answered");
    expect(bullseyeAtlasLine(s.results)).toBe("Atlas scored 1,000, holding 1 of 1 ring, 900 ahead of you.");
    let t = bullseyeReducer(initialBullseye, { type: "start", order: ["a"] });
    t = play(t, PARIS, 0, PARIS, { ...PARIS, confidence: 0.9 });
    if (t.phase !== "answered") throw new Error("not answered");
    expect(bullseyeAtlasLine(t.results)).toBe("Atlas scored 1,000, holding 1 of 1 ring: level with you.");
  });
});

describe("the best", () => {
  it("keeps the highest game and reads junk as none", () => {
    expect(loadBestBullseye()).toBe(0);
    expect(rememberBullseye(1250)).toBe(1250);
    expect(rememberBullseye(600)).toBe(1250);
    expect(loadBestBullseye()).toBe(1250);
    localStorage.setItem(BEST_BULLSEYE_KEY, "soup");
    expect(loadBestBullseye()).toBe(0);
  });
});
