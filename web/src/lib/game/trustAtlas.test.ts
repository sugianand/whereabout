import { afterEach, describe, expect, it, vi } from "vitest";

import { bundledById, bundledDeck, bundledTrustIds } from "./bundled";
import type { GameRecord } from "./deck";
import {
  ATLAS_TRUSTS_FROM,
  BEST_TRUST_KEY,
  TRUST_PHOTOS,
  atlasCall,
  atlasCallLine,
  atlasPick,
  dealTrust,
  initialTrust,
  loadBestTrust,
  percent,
  rememberTrust,
  rightCall,
  trustEndLine,
  trustIds,
  trustReducer,
  trustResult,
  trustTotals,
  truthRank,
  type TrustResult,
} from "./trustAtlas";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function record(id: string, country: string, top: [string, number][] | null): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country,
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: top
      ? {
          lng: 0,
          lat: 0,
          confidence: top[0]?.[1] ?? 0,
          topCountries: top.map(([c, p]) => ({ country: c, p })),
          clues: [],
        }
      : null,
  };
}

describe("which photos can be dealt", () => {
  it("needs Atlas to have named a country with a probability", () => {
    expect(atlasPick(record("a", "FR", [["FR", 0.8]]).atlas)).toEqual({ country: "FR", p: 0.8 });
    expect(atlasPick(record("b", "FR", []).atlas)).toBeNull();
    expect(atlasPick(record("c", "FR", null).atlas)).toBeNull();
    const odd = record("d", "FR", [["FR", 0.8]]);
    odd.atlas!.confidence = Number.NaN;
    // Falls back to the shortlist's own probability.
    expect(atlasPick(odd.atlas)).toEqual({ country: "FR", p: 0.8 });
    odd.atlas!.topCountries[0]!.p = 1.5;
    expect(atlasPick(odd.atlas)).toBeNull();
    expect(
      trustIds([record("a", "FR", [["FR", 0.8]]), record("b", "FR", []), record("c", "FR", null)]),
    ).toEqual(["a"]);
  });

  it("deals ten different photos from the real catalog, each one Atlas named a country for", () => {
    expect(bundledTrustIds.length).toBeGreaterThanOrEqual(TRUST_PHOTOS);
    for (const id of bundledTrustIds) expect(bundledDeck.ids).toContain(id);
    const game = dealTrust(bundledTrustIds, 42);
    expect(game).toHaveLength(TRUST_PHOTOS);
    expect(new Set(game).size).toBe(TRUST_PHOTOS);
    for (const id of game) expect(atlasPick(bundledById.get(id)!.atlas)).not.toBeNull();
    expect(dealTrust(bundledTrustIds, 42)).toEqual(game);
    expect(dealTrust(bundledTrustIds, 43)).not.toEqual(game);
    expect(dealTrust(["a", "b"], 1)).toHaveLength(2);
  });

  it("deals photos Atlas got right and photos it got wrong, so neither call always wins", () => {
    const right = bundledTrustIds.filter((id) => {
      const r = bundledById.get(id)!;
      return atlasPick(r.atlas)!.country === r.photo.country;
    });
    expect(right.length).toBeGreaterThan(0);
    expect(right.length).toBeLessThan(bundledTrustIds.length);
  });
});

describe("calls", () => {
  it("has Atlas trust itself from 50% sure", () => {
    expect(ATLAS_TRUSTS_FROM).toBe(0.5);
    expect(atlasCall(0.5)).toBe("trust");
    expect(atlasCall(0.92)).toBe("trust");
    expect(atlasCall(0.4999)).toBe("doubt");
    expect(rightCall(true)).toBe("trust");
    expect(rightCall(false)).toBe("doubt");
  });

  it("judges both sides on the photo's real country", () => {
    const sureRight = record("a", "LA", [
      ["LA", 0.85],
      ["VN", 0.12],
    ]);
    expect(trustResult(sureRight, "trust")).toEqual({
      id: "a",
      call: "trust",
      atlasRight: true,
      correct: true,
      atlasCall: "trust",
      atlasCorrect: true,
    });
    expect(trustResult(sureRight, "doubt")).toMatchObject({ correct: false, atlasCorrect: true });

    // Unsure and wrong: doubting it is correct, and so is Atlas's own doubt.
    const unsureWrong = record("b", "VN", [
      ["LA", 0.3],
      ["VN", 0.25],
    ]);
    expect(trustResult(unsureWrong, "doubt")).toMatchObject({
      atlasRight: false,
      correct: true,
      atlasCall: "doubt",
      atlasCorrect: true,
    });
    // Sure but wrong: Atlas's own call misses.
    const sureWrong = record("c", "NO", [["SE", 0.7]]);
    expect(trustResult(sureWrong, "doubt")).toMatchObject({ correct: true, atlasCorrect: false });
    // Unsure but right.
    const unsureRight = record("d", "PE", [["PE", 0.2]]);
    expect(trustResult(unsureRight, "trust")).toMatchObject({ correct: true, atlasCorrect: false });

    expect(trustResult(record("e", "FR", null), "trust")).toBeNull();
  });

  it("finds the real country on Atlas's shortlist", () => {
    const r = record("a", "VN", [
      ["LA", 0.6],
      ["VN", 0.3],
      ["TH", 0.05],
    ]);
    expect(truthRank(r.atlas, "VN")).toEqual({ rank: 2, p: 0.3 });
    expect(truthRank(r.atlas, "LA")).toEqual({ rank: 1, p: 0.6 });
    expect(truthRank(r.atlas, "KH")).toBeNull();
    expect(truthRank(null, "KH")).toBeNull();
  });
});

const result = (id: string, correct: boolean, atlasCorrect = true): TrustResult => ({
  id,
  call: "trust",
  atlasRight: correct,
  correct,
  atlasCall: atlasCorrect === correct ? "trust" : "doubt",
  atlasCorrect,
});

describe("the reducer", () => {
  it("plays every photo, one call each, in order", () => {
    let s = trustReducer(initialTrust, { type: "start", order: ["a", "b"] });
    expect(s.phase).toBe("calling");
    // Out of turn, or before the photo is up, a call is ignored.
    expect(trustReducer(s, { type: "called", result: result("b", true) })).toBe(s);
    expect(trustReducer(s, { type: "next" })).toBe(s);
    s = trustReducer(s, { type: "called", result: result("a", true) });
    expect(s.phase).toBe("answered");
    // A second call on the same photo is ignored.
    expect(trustReducer(s, { type: "called", result: result("a", false) })).toBe(s);
    s = trustReducer(s, { type: "next" });
    expect(s.phase).toBe("calling");
    s = trustReducer(s, { type: "called", result: result("b", false) });
    s = trustReducer(s, { type: "next" });
    expect(s).toEqual({
      phase: "done",
      order: ["a", "b"],
      results: [result("a", true), result("b", false)],
    });
  });

  it("ends at once with nothing to deal", () => {
    expect(trustReducer(initialTrust, { type: "start", order: [] })).toEqual({
      phase: "done",
      order: [],
      results: [],
    });
  });
});

describe("the words", () => {
  it("counts the calls", () => {
    const rs = [result("a", true, true), result("b", true, false), result("c", false, true)];
    expect(trustTotals(rs)).toEqual({ correct: 2, atlasCorrect: 2, atlasRight: 2 });
  });

  it("writes probabilities as the game shows them", () => {
    expect(percent(0.851)).toBe("85%");
    expect(percent(0.004)).toBe("under 1%");
    expect(percent(0)).toBe("0%");
    expect(percent(1)).toBe("100%");
  });

  it("says what Atlas made of its own answer", () => {
    const r = trustResult(record("a", "SE", [["SE", 0.85]]), "doubt")!;
    expect(atlasCallLine(r, 0.85)).toBe(
      "At 85% sure, Atlas trusted its answer, and that call was right.",
    );
    const w = trustResult(record("b", "SE", [["SE", 0.3]]), "doubt")!;
    expect(atlasCallLine(w, 0.3)).toBe(
      "At only 30% sure, Atlas doubted its answer, and that call was wrong.",
    );
  });

  it("calls who read Atlas better at the end", () => {
    expect(trustEndLine([result("a", true, false)])).toBe(
      "You read Atlas better than it reads itself. Atlas trusts itself at 50% sure or more: that called 0 of 1.",
    );
    expect(trustEndLine([result("a", false, true)])).toMatch(
      /^Atlas's own sureness called it better/,
    );
    expect(trustEndLine([result("a", true, true)])).toMatch(
      /^You and Atlas's own sureness called it level/,
    );
  });
});

describe("the best", () => {
  it("keeps the most correct calls of a whole game", () => {
    expect(loadBestTrust()).toBe(0);
    expect(rememberTrust(6)).toBe(6);
    expect(rememberTrust(4)).toBe(6);
    expect(rememberTrust(9)).toBe(9);
    expect(localStorage.getItem(BEST_TRUST_KEY)).toBe("9");
    expect(loadBestTrust()).toBe(9);
  });

  it("refuses a best no game could score, and junk", () => {
    expect(rememberTrust(11)).toBe(0);
    expect(rememberTrust(2.5)).toBe(0);
    for (const junk of ["11", "-1", "2.5", '"7"', "{", "0"]) {
      localStorage.setItem(BEST_TRUST_KEY, junk);
      expect(loadBestTrust()).toBe(0);
    }
  });

  it("survives storage that can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(rememberTrust(5)).toBe(5);
    expect(loadBestTrust()).toBe(0);
  });
});
