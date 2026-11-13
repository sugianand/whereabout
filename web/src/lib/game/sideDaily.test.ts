import { beforeEach, describe, expect, it } from "vitest";

import { bundledDrivingSides } from "./bundled";
import { hashSeed } from "./daily";
import { leftRightOrder, type SideMap } from "./leftRight";
import {
  SIDE_DAILY_KEY,
  dailySideOrder,
  loadSideDay,
  loadSideDays,
  rememberSideDay,
  sideDailyShare,
  sideDaySeed,
  type SideDay,
} from "./sideDaily";

/** `left` photos on the left and `right` on the right, ids l0.. and r0.. */
function sideMap(left: number, right: number): SideMap {
  const map: Record<string, "left" | "right"> = {};
  for (let i = 0; i < left; i++) map[`l${i}`] = "left";
  for (let i = 0; i < right; i++) map[`r${i}`] = "right";
  return map;
}

const SIDES = sideMap(12, 40);

beforeEach(() => localStorage.clear());

describe("dailySideOrder", () => {
  it("deals the same photos to everyone on a day, and others the next day", () => {
    const today = dailySideOrder(SIDES, "2026-11-13");
    expect(dailySideOrder({ ...SIDES }, "2026-11-13")).toEqual(today);
    expect(dailySideOrder(SIDES, "2026-11-14")).not.toEqual(today);
  });

  it("is the free runs' even deal on the day's own seed", () => {
    expect(dailySideOrder(SIDES, "2026-11-13")).toEqual(
      leftRightOrder(SIDES, hashSeed("whereabout:left-right:2026-11-13")),
    );
    expect(sideDaySeed("2026-11-13")).not.toBe(hashSeed("whereabout:2026-11-13"));
    expect(sideDaySeed("2026-11-13")).not.toBe(hashSeed("whereabout:further-north:2026-11-13"));
  });

  it("deals the bundled photos evenly, never repeating one", () => {
    const order = dailySideOrder(bundledDrivingSides, "2026-11-13");
    expect(order.length).toBeGreaterThan(10);
    expect(new Set(order).size).toBe(order.length);
    // Drawn by a fair coin until one pile runs out: that pile is spent, the other isn't.
    const lefts = Object.values(bundledDrivingSides).filter((s) => s === "left").length;
    const dealtLeft = order.filter((id) => bundledDrivingSides[id] === "left").length;
    const dealtRight = order.length - dealtLeft;
    const rights = Object.keys(bundledDrivingSides).length - lefts;
    expect(dealtLeft === lefts || dealtRight === rights).toBe(true);
  });
});

describe("the kept days", () => {
  const going: SideDay = { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: null };

  it("keep a run per day under the game's own key, apart from the free runs' best", () => {
    rememberSideDay("2026-11-13", going);
    rememberSideDay("2026-11-12", { ...going, ended: "miss" });
    expect(loadSideDay("2026-11-13")).toEqual(going);
    expect(loadSideDay("2026-11-12")?.ended).toBe("miss");
    expect(loadSideDay("2026-11-11")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(SIDE_DAILY_KEY)!))).toHaveLength(2);
    expect(localStorage.getItem("whereabout:left-right-best")).toBeNull();
  });

  it("skip anything not in the shape they are written in", () => {
    localStorage.setItem(
      SIDE_DAILY_KEY,
      JSON.stringify({
        "2026-11-13": going,
        "2026-11-12": { ...going, streak: 1.5 },
        "2026-11-11": { ...going, ended: "won" },
        yesterday: going,
      }),
    );
    expect(loadSideDays()).toEqual({ "2026-11-13": going });
  });
});

describe("sideDailyShare", () => {
  const href = "https://example.org/whereabout/left-right/daily/?x=1#y";

  it("is the day, the run and Atlas's tally in counts, with the page's bare address", () => {
    const text = sideDailyShare(
      "2026-11-13",
      { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" },
      href,
    );
    expect(text).toBe(
      [
        "Whereabout · Left or right? · 2026-11-13",
        "🛣️ 3 photos in a row",
        "🟩🟩🟩🟥",
        "Atlas: 2 of 4",
        "https://example.org/whereabout/left-right/daily/",
      ].join("\n"),
    );
  });

  it("says when every photo was called, and leaves Atlas out when it called none", () => {
    const text = sideDailyShare(
      "2026-11-13",
      { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "cleared" },
      href,
    );
    expect(text).toContain("🛣️ 1 photo in a row, every photo\n🟩🏁\n");
    expect(text).not.toContain("Atlas");
  });
});
