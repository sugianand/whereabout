import { beforeEach, describe, expect, it } from "vitest";

import { settleBet, type BullseyeRound } from "./bullseye";
import {
  BULLSEYE_CALIBRATION_KEY,
  addRound,
  calibrationFromDays,
  calibrationLeader,
  calibrationLine,
  emptyCalibration,
  heldRate,
  loadCalibration,
  loadFreeCalibration,
  parseCalibration,
  recordBullseyeRound,
  totals,
} from "./bullseyeCalibration";
import { BULLSEYE_DAILY_KEY, rememberBullseyeDay } from "./bullseyeDaily";

const AT = { lng: 2.35, lat: 48.86 };

/** A photo bet on: your ring and distance, and Atlas's or null. */
function round(
  id: string,
  you: [ring: number, km: number],
  atlas: [ring: number, km: number] | null = null,
): BullseyeRound {
  return {
    id,
    you: settleBet(AT, you[0], you[1]),
    atlas: atlas ? settleBet(AT, atlas[0], atlas[1]) : null,
  };
}

beforeEach(() => localStorage.clear());

describe("addRound", () => {
  it("counts each side's bet on its own ring, held only inside it", () => {
    let cal = emptyCalibration();
    cal = addRound(cal, round("a", [0, 100], [1, 900])); // you held 250; Atlas missed 750
    cal = addRound(cal, round("b", [0, 400], [1, 750])); // you missed 250; Atlas on its line
    cal = addRound(cal, round("c", [3, 4000])); // Atlas sat out
    expect(cal.you).toEqual([
      { bet: 2, held: 1 },
      { bet: 0, held: 0 },
      { bet: 0, held: 0 },
      { bet: 1, held: 1 },
    ]);
    expect(cal.atlas).toEqual([
      { bet: 0, held: 0 },
      { bet: 2, held: 1 },
      { bet: 0, held: 0 },
      { bet: 0, held: 0 },
    ]);
    expect(totals(cal.you)).toEqual({ bet: 3, held: 2 });
    expect(heldRate(totals(cal.atlas))).toBe(0.5);
    expect(heldRate({ bet: 0, held: 0 })).toBeNull();
  });
});

describe("the kept tallies", () => {
  it("adds bets across visits and reads them back", () => {
    recordBullseyeRound(round("a", [0, 100], [0, 300]));
    recordBullseyeRound(round("b", [2, 2500], [2, 1500]));
    const cal = loadFreeCalibration();
    expect(totals(cal.you)).toEqual({ bet: 2, held: 1 });
    expect(totals(cal.atlas)).toEqual({ bet: 2, held: 1 });
  });

  it("never keeps a photo or a pin, only counts", () => {
    recordBullseyeRound(round("wm001", [0, 100]));
    const raw = localStorage.getItem(BULLSEYE_CALIBRATION_KEY)!;
    expect(raw).not.toContain("wm001");
    expect(raw).not.toContain("48.86");
  });

  it("adds today's kept days to the free games, counting each photo once", () => {
    recordBullseyeRound(round("free", [1, 500]));
    rememberBullseyeDay("2026-11-20", [round("d1", [0, 200], [0, 100]), round("d2", [0, 300], [3, 300])]);
    rememberBullseyeDay("2026-11-21", [round("d3", [3, 6000])]);
    const cal = loadCalibration();
    expect(totals(cal.you)).toEqual({ bet: 4, held: 2 });
    expect(cal.you[0]).toEqual({ bet: 2, held: 1 });
    expect(cal.atlas[0]).toEqual({ bet: 1, held: 1 });
    expect(cal.atlas[3]).toEqual({ bet: 1, held: 1 });
    expect(calibrationFromDays({})).toEqual(emptyCalibration());
  });

  it("reads junk, a forged tally or blocked storage as nothing kept", () => {
    const store = (v: unknown) => localStorage.setItem(BULLSEYE_CALIBRATION_KEY, JSON.stringify(v));
    const side = (bet: number, held: number) => [0, 1, 2, 3].map(() => ({ bet, held }));
    localStorage.setItem(BULLSEYE_CALIBRATION_KEY, "{not json");
    expect(loadFreeCalibration()).toEqual(emptyCalibration());
    store({ you: side(1, 2), atlas: side(0, 0) }); // held more than bet
    expect(loadFreeCalibration()).toEqual(emptyCalibration());
    store({ you: side(1, 1), atlas: side(2, 0) }); // Atlas bet more photos than you
    expect(loadFreeCalibration()).toEqual(emptyCalibration());
    store({ you: side(1, 1).slice(0, 3), atlas: side(0, 0) }); // a ring missing
    expect(loadFreeCalibration()).toEqual(emptyCalibration());
    expect(parseCalibration({ you: side(1.5, 1), atlas: side(0, 0) })).toBeNull();
    expect(parseCalibration({ you: side(3, 2), atlas: side(1, 1) })).toEqual({
      you: side(3, 2),
      atlas: side(1, 1),
    });
    localStorage.setItem(BULLSEYE_DAILY_KEY, "[]");
    expect(loadCalibration()).toEqual(emptyCalibration());
  });
});

describe("the words", () => {
  it("gives both sides' rings held, and Atlas's only once it has bet", () => {
    let cal = addRound(emptyCalibration(), round("a", [0, 100]));
    expect(calibrationLine(cal)).toBe("Your rings held 1 of 1 photo (100%).");
    expect(calibrationLeader(cal)).toBeNull();
    cal = addRound(cal, round("b", [0, 400], [1, 900]));
    cal = addRound(cal, round("c", [1, 400], [1, 400]));
    expect(calibrationLine(cal)).toBe(
      "Your rings held 2 of 3 photos (67%); Atlas's held 1 of 2 (50%).",
    );
    expect(calibrationLeader(cal)).toBe("you");
  });

  it("calls equal rates on different counts level, and a better Atlas ahead", () => {
    let cal = emptyCalibration();
    cal = addRound(cal, round("a", [0, 100], [0, 100]));
    cal = addRound(cal, round("b", [0, 400], [0, 400]));
    cal = addRound(cal, round("c", [0, 100]));
    cal = addRound(cal, round("d", [0, 400]));
    expect(calibrationLeader(cal)).toBe("level");
    cal = addRound(cal, round("e", [0, 400], [3, 100]));
    expect(calibrationLeader(cal)).toBe("atlas");
  });
});
