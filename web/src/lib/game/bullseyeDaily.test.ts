import { beforeEach, describe, expect, it } from "vitest";

import { BULLSEYE_PHOTOS, bet, type BullseyeRound } from "./bullseye";
import {
  BULLSEYE_DAILY_KEY,
  bullseyeDailyShare,
  bullseyeDayDone,
  dailyBullseyeOrder,
  loadBullseyeDay,
  parseBullseyeDay,
  rememberBullseyeDay,
} from "./bullseyeDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const HREF = "https://example.test/whereabout/bullseye/daily/?x=1#y";
const PARIS = { lng: 2.35, lat: 48.86 };
const BERLIN = { lng: 13.4, lat: 52.52 };
const TOKYO = { lng: 139.69, lat: 35.69 };

// Paris to Berlin is about 880 km: outside the 750 km ring, inside the 2,000 km one.
const held: BullseyeRound = { id: "p1", you: bet(PARIS, 2, BERLIN), atlas: bet(TOKYO, 0, BERLIN) };
const missed: BullseyeRound = { id: "p2", you: bet(PARIS, 1, BERLIN), atlas: null };

beforeEach(() => localStorage.clear());

/** Through JSON, as storage holds it, then back. */
const stored = (day: unknown) => JSON.parse(JSON.stringify(day)) as unknown;

describe("the day's deal", () => {
  it("is five photos, the same for everyone on a day, and changes with the day", () => {
    const day = dailyBullseyeOrder(IDS, "2026-11-21");
    expect(day).toHaveLength(BULLSEYE_PHOTOS);
    expect(new Set(day).size).toBe(BULLSEYE_PHOTOS);
    expect(dailyBullseyeOrder(IDS, "2026-11-21")).toEqual(day);
    expect(dailyBullseyeOrder(IDS, "2026-11-22")).not.toEqual(day);
  });
});

describe("the day kept", () => {
  it("keeps each bet and reads the day back the same", () => {
    rememberBullseyeDay("2026-11-21", [held, missed]);
    expect(loadBullseyeDay("2026-11-21")).toEqual({ results: [held, missed] });
    expect(loadBullseyeDay("2026-11-22")).toBeNull();
    expect(bullseyeDayDone(loadBullseyeDay("2026-11-21"))).toBe(false);
  });

  it("is done once every photo is bet on", () => {
    const five = IDS.slice(0, 5).map((id) => ({ ...missed, id }));
    rememberBullseyeDay("2026-11-21", five);
    expect(bullseyeDayDone(loadBullseyeDay("2026-11-21"))).toBe(true);
    expect(bullseyeDayDone(null)).toBe(false);
  });

  it("settles each bet from its distance and ring, not from what was stored", () => {
    const forged = { results: [{ ...missed, you: { ...missed.you, inside: true, score: 1000 } }] };
    const back = parseBullseyeDay(stored(forged))!.results[0]!;
    expect(back.you).toMatchObject({ inside: false, score: 0, ring: 1 });
    expect(back.you).toEqual(missed.you);
  });

  it.each<[string, unknown]>([
    ["not an object", "x"],
    ["no results", {}],
    ["too many photos", { results: IDS.slice(0, 6).map((id) => ({ ...missed, id })) }],
    ["the same photo twice", { results: [missed, missed] }],
    ["no id", { results: [{ ...missed, id: "" }] }],
    ["a ring that isn't one", { results: [{ ...missed, you: { ...missed.you, ring: 4 } }] }],
    ["a fractional ring", { results: [{ ...missed, you: { ...missed.you, ring: 0.5 } }] }],
    ["a negative distance", { results: [{ ...missed, you: { ...missed.you, km: -1 } }] }],
    ["a distance off the Earth", { results: [{ ...missed, you: { ...missed.you, km: 30_000 } }] }],
    ["a pin off the map", { results: [{ ...missed, you: { ...missed.you, at: { lng: 0, lat: 91 } } }] }],
    ["no bet of yours", { results: [{ id: "p1", atlas: null }] }],
    ["a broken bet of Atlas's", { results: [{ ...missed, atlas: { ring: 0 } }] }],
  ])("is not read back with %s", (_, value) => {
    expect(parseBullseyeDay(stored(value))).toBeNull();
  });

  it("skips a junk day and keeps the good ones", () => {
    localStorage.setItem(
      BULLSEYE_DAILY_KEY,
      JSON.stringify({ "2026-11-21": stored({ results: [held] }), "2026-11-22": { results: 1 } }),
    );
    expect(loadBullseyeDay("2026-11-21")).toEqual({ results: [held] });
    expect(loadBullseyeDay("2026-11-22")).toBeNull();
  });

  it("reads nothing back from storage that isn't JSON", () => {
    localStorage.setItem(BULLSEYE_DAILY_KEY, "{not json");
    expect(loadBullseyeDay("2026-11-21")).toBeNull();
  });
});

describe("the share line", () => {
  it("is points, each ring and whether it held, and Atlas's tally: no place, no distance", () => {
    const text = bullseyeDailyShare("2026-11-21", [held, missed], HREF);
    expect(text).toBe(
      [
        "Whereabout · Bullseye · 2026-11-21",
        "🎯 250 of 2,000 · 1 of 2 rings held",
        "🟩 2,000 km  🟥 750 km",
        "Atlas: 0 on 1 of the photos · 0 of 1 ring held",
        "https://example.test/whereabout/bullseye/daily/",
      ].join("\n"),
    );
    // Neither pin's distance from the photo goes out.
    expect(text).not.toMatch(/88\d|7,7\d\d|8,\d\d\d/);
  });

  it("names the rings in the player's units, and leaves Atlas out when it played none", () => {
    const text = bullseyeDailyShare("2026-11-21", [missed], HREF, "mi");
    expect(text.split("\n")[2]).toBe("🟥 466 mi");
    expect(text).not.toContain("Atlas");
  });
});
