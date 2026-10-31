import { afterEach, describe, expect, it } from "vitest";

import { BLITZ_BEST_KEY } from "./blitz";
import { BEST_NORTH_KEY } from "./furtherNorth";
import { BEST_ODD_KEY } from "./oddOneOut";
import { NO_BESTS, QUICK_MODES, bestLine, bestStreak, loadQuickBests } from "./quickBests";
import { BEST_STREAK_KEY, bestStreakKey } from "./streak";
import { BEST_SURVIVAL_KEY } from "./survival";

afterEach(() => localStorage.clear());

describe("loadQuickBests", () => {
  it("reads nothing from an empty browser", () => {
    expect(loadQuickBests()).toEqual(NO_BESTS);
    for (const mode of QUICK_MODES) expect(bestLine(mode, NO_BESTS)).toBeNull();
  });

  it("reads each mode's best from the key that mode keeps it under", () => {
    localStorage.setItem(BLITZ_BEST_KEY, "18250");
    localStorage.setItem(BEST_STREAK_KEY, "6");
    localStorage.setItem(BEST_SURVIVAL_KEY, JSON.stringify({ survived: 4, total: 15200 }));
    localStorage.setItem(BEST_NORTH_KEY, "9");
    localStorage.setItem(BEST_ODD_KEY, "3");
    expect(loadQuickBests()).toEqual({
      blitz: 18250,
      streak: { streak: 6, region: null },
      survival: { survived: 4, total: 15200 },
      "further-north": 9,
      "odd-one-out": 3,
    });
  });

  it("refuses what the modes refuse: junk and zero streaks read as no best", () => {
    localStorage.setItem(BEST_NORTH_KEY, "0");
    localStorage.setItem(BEST_ODD_KEY, "not a number");
    localStorage.setItem(BEST_SURVIVAL_KEY, "{");
    const bests = loadQuickBests();
    expect(bests["further-north"]).toBeNull();
    expect(bests["odd-one-out"]).toBeNull();
    expect(bests.survival).toBeNull();
  });
});

describe("bestStreak", () => {
  it("shows a continent's run when it beats the all-world one", () => {
    localStorage.setItem(BEST_STREAK_KEY, "3");
    localStorage.setItem(bestStreakKey("europe"), "7");
    localStorage.setItem(bestStreakKey("asia"), "5");
    expect(bestStreak()).toEqual({ streak: 7, region: "Europe" });
  });

  it("keeps the all-world run on a tie", () => {
    localStorage.setItem(BEST_STREAK_KEY, "4");
    localStorage.setItem(bestStreakKey("oceania"), "4");
    expect(bestStreak()).toEqual({ streak: 4, region: null });
  });

  it("is null before any streak", () => {
    expect(bestStreak(() => 0)).toBeNull();
  });
});

describe("bestLine", () => {
  const bests = {
    blitz: 18250,
    streak: { streak: 7, region: "South America" as const },
    survival: { survived: 1, total: 4800 },
    "further-north": 9,
    "odd-one-out": 1,
  };

  it("reads each best the way its card shows it", () => {
    expect(bestLine("blitz", bests)).toBe("Best: 18,250 points");
    expect(bestLine("streak", bests)).toBe("Best: 7 in a row in South America");
    expect(bestLine("survival", bests)).toBe("Best: 1 photo, 4,800 points");
    expect(bestLine("further-north", bests)).toBe("Best: 9 in a row");
    expect(bestLine("odd-one-out", bests)).toBe("Best: 1 in a row");
  });

  it("names no continent for an all-world streak, and counts photos in the plural", () => {
    expect(bestLine("streak", { ...bests, streak: { streak: 2, region: null } })).toBe(
      "Best: 2 in a row",
    );
    expect(bestLine("survival", { ...bests, survival: { survived: 3, total: 9000 } })).toBe(
      "Best: 3 photos, 9,000 points",
    );
  });

  it("shows a Blitz of no points as a best: the game was played", () => {
    expect(bestLine("blitz", { ...NO_BESTS, blitz: 0 })).toBe("Best: 0 points");
  });
});
