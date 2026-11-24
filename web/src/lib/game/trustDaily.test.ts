import { beforeEach, describe, expect, it } from "vitest";

import type { GameRecord } from "./deck";
import { dailySpotOrder } from "./spotDaily";
import { TRUST_PHOTOS, trustResult, type TrustResult } from "./trustAtlas";
import {
  TRUST_DAILY_KEY,
  dailyTrustOrder,
  loadTrustDay,
  parseTrustDay,
  rememberTrustDay,
  settleTrust,
  trustDailyShare,
  trustDayDone,
  trustMark,
} from "./trustDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const HREF = "https://example.test/whereabout/trust-atlas/daily/?x=1#y";

/** A photo in `country` that Atlas called `atlas` at probability `p`. */
const record = (id: string, country: string, atlas: string, p: number) =>
  ({
    photo: { id, country },
    atlas: { confidence: p, topCountries: [{ country: atlas, p }] },
  }) as unknown as GameRecord;

// Atlas right and sure; right but unsure; wrong and sure.
const rightSure = record("p1", "FR", "FR", 0.8);
const rightUnsure = record("p2", "JP", "JP", 0.3);
const wrongSure = record("p3", "PE", "BO", 0.7);

const r1 = trustResult(rightSure, "trust")!; // called it; Atlas's own call right
const r2 = trustResult(rightUnsure, "doubt")!; // missed; Atlas doubted itself, wrong
const r3 = trustResult(wrongSure, "doubt")!; // called it; Atlas trusted itself, wrong

beforeEach(() => localStorage.clear());

const stored = (day: unknown) => JSON.parse(JSON.stringify(day)) as unknown;

describe("the day's deal", () => {
  it("is ten photos, the same for everyone on a day, and changes with the day", () => {
    const day = dailyTrustOrder(IDS, "2026-11-25");
    expect(day).toHaveLength(TRUST_PHOTOS);
    expect(new Set(day).size).toBe(TRUST_PHOTOS);
    expect(dailyTrustOrder(IDS, "2026-11-25")).toEqual(day);
    expect(dailyTrustOrder(IDS, "2026-11-26")).not.toEqual(day);
  });

  it("is dealt on its own seed, apart from the other daily games' photos that day", () => {
    const spot = dailySpotOrder(IDS, "2026-11-25");
    expect(dailyTrustOrder(IDS, "2026-11-25").slice(0, spot.length)).not.toEqual(spot);
  });

  it("deals every photo there is when there are fewer than ten", () => {
    expect(dailyTrustOrder(IDS.slice(0, 4), "2026-11-25").sort()).toEqual(IDS.slice(0, 4).sort());
  });
});

describe("the day kept", () => {
  it("keeps each call and reads the day back the same", () => {
    rememberTrustDay("2026-11-25", [r1, r2]);
    expect(loadTrustDay("2026-11-25")).toEqual({ results: [r1, r2] });
    expect(loadTrustDay("2026-11-26")).toBeNull();
    expect(trustDayDone(loadTrustDay("2026-11-25"))).toBe(false);
  });

  it("is done once all ten photos are called", () => {
    const ten = IDS.slice(0, TRUST_PHOTOS).map((id) => ({ ...r1, id }));
    rememberTrustDay("2026-11-25", ten);
    expect(trustDayDone(loadTrustDay("2026-11-25"))).toBe(true);
    expect(trustDayDone(null)).toBe(false);
  });

  it("writes only the result's own fields", () => {
    rememberTrustDay("2026-11-25", [{ ...r1, extra: "x" } as TrustResult]);
    const raw = JSON.parse(localStorage.getItem(TRUST_DAILY_KEY)!) as Record<string, unknown>;
    expect(raw["2026-11-25"]).toEqual({ results: [r1] });
  });

  it("reads back a day that agrees with itself, through storage", () => {
    expect(parseTrustDay(stored({ results: [r1, r2, r3] }))).toEqual({ results: [r1, r2, r3] });
  });

  it("refuses a call that claims to be right when it doesn't follow from Atlas's answer", () => {
    expect(parseTrustDay({ results: [{ ...r2, correct: true }] })).toBeNull();
    expect(parseTrustDay({ results: [{ ...r3, atlasCorrect: true }] })).toBeNull();
  });

  it("refuses anything not in the shape it writes", () => {
    expect(parseTrustDay(null)).toBeNull();
    expect(parseTrustDay({})).toBeNull();
    expect(parseTrustDay({ results: [{ ...r1, call: "maybe" }] })).toBeNull();
    expect(parseTrustDay({ results: [{ ...r1, id: "" }] })).toBeNull();
    expect(parseTrustDay({ results: [{ ...r1, atlasRight: "yes" }] })).toBeNull();
    expect(parseTrustDay({ results: [r1, r1] })).toBeNull();
    const eleven = Array.from({ length: TRUST_PHOTOS + 1 }, (_, i) => ({ ...r1, id: `p${i}` }));
    expect(parseTrustDay({ results: eleven })).toBeNull();
  });

  it("skips a malformed day without losing the others", () => {
    localStorage.setItem(
      TRUST_DAILY_KEY,
      JSON.stringify({ "2026-11-25": { results: [r1] }, "2026-11-26": { results: "no" } }),
    );
    expect(loadTrustDay("2026-11-25")).toEqual({ results: [r1] });
    expect(loadTrustDay("2026-11-26")).toBeNull();
  });
});

describe("settling a kept day", () => {
  it("judges each call again on its photo, keeping only the call from storage", () => {
    // A stored day that agrees with itself but not with the photo: it says Atlas was wrong.
    const forged: TrustResult = {
      id: "p1",
      call: "doubt",
      atlasRight: false,
      correct: true,
      atlasCall: "doubt",
      atlasCorrect: true,
    };
    const settled = settleTrust([forged], new Map([["p1", rightSure]]));
    expect(settled).toEqual([trustResult(rightSure, "doubt")]);
    expect(settled[0]!.correct).toBe(false);
  });

  it("keeps a photo still loading as it was read back", () => {
    expect(settleTrust([r1, r3], new Map([["p1", rightSure]]))).toEqual([r1, r3]);
  });
});

describe("the share", () => {
  it("is counts beside Atlas's own and a square per call, naming no place or country", () => {
    const text = trustDailyShare("2026-11-25", [r1, r2, r3], HREF);
    expect(text).toBe(
      [
        "Whereabout · Trust Atlas? · 2026-11-25",
        "🤔 2 of 3 called right · Atlas's own sureness 1 of 3",
        "🟩🟥🟩",
        "https://example.test/whereabout/trust-atlas/daily/",
      ].join("\n"),
    );
    expect(text).not.toMatch(/\b(FR|JP|PE|BO)\b/);
    expect(text).not.toMatch(/France|Japan|Peru|Bolivia|trust(ed)? it|doubt/i);
    expect(trustMark(r1)).toBe("🟩");
    expect(trustMark(r2)).toBe("🟥");
  });
});
