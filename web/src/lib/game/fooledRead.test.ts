import { beforeEach, describe, expect, it } from "vitest";

import { atlasFooledPick, judgeFooled, type Side } from "./fooledAtlas";
import {
  FOOLED_READ_KEY,
  addPair,
  emptyFooledRead,
  fooledReadLeader,
  fooledReadLine,
  fooledReadTotals,
  gapOf,
  gapRatio,
  loadFooledRead,
  parseFooledRead,
  recordFooledRead,
  tiesLine,
} from "./fooledRead";

beforeEach(() => window.localStorage.clear());

/** A pick of `side` on misses of `a` and `b` km, with Atlas's own pick from its sureness. */
function pair(side: Side, a: number, b: number, sureA: number | null = 0.4, sureB = 0.6) {
  const own = atlasFooledPick(sureA, sureB);
  return [judgeFooled(side, a, b), own === null ? null : judgeFooled(own, a, b), a, b] as const;
}

describe("gapRatio and gapOf", () => {
  it("is the larger miss over the smaller, either way round", () => {
    expect(gapRatio(100, 400)).toBe(4);
    expect(gapRatio(400, 100)).toBe(4);
  });

  it("takes a miss on the spot as 1 km, so the gap stays finite", () => {
    expect(gapRatio(0, 50)).toBe(50);
    expect(gapRatio(0.2, 50)).toBe(50);
  });

  it("bands the gap as close, clear and far apart", () => {
    expect(gapOf(100, 200)).toBe(0);
    expect(gapOf(100, 299)).toBe(0);
    expect(gapOf(100, 300)).toBe(1);
    expect(gapOf(9_999, 1_000)).toBe(1);
    expect(gapOf(100, 1_000)).toBe(2);
    expect(gapOf(3, 12_000)).toBe(2);
  });
});

describe("addPair", () => {
  it("counts your pick and Atlas's own in the pair's band", () => {
    // Atlas was less sure of photo a, so it picks a, which it missed by more: right.
    let read = addPair(emptyFooledRead(), ...pair("a", 2_000, 100));
    expect(read.bands[2]).toEqual({ pairs: 1, you: 1, atlas: 1 });
    // A close pair: you pick b, Atlas picks a; a was the bigger miss.
    read = addPair(read, ...pair("b", 500, 200));
    expect(read.bands[0]).toEqual({ pairs: 1, you: 0, atlas: 1 });
    // A clear pair Atlas gets wrong: it picks a, but b was the bigger miss.
    read = addPair(read, ...pair("b", 100, 500));
    expect(read.bands[1]).toEqual({ pairs: 1, you: 1, atlas: 0 });
    expect(fooledReadTotals(read)).toEqual({ pairs: 3, you: 2, atlas: 2 });
    expect(read.ties).toBe(0);
  });

  it("sets dead heats aside, as both near misses or within the tie ratio", () => {
    let read = addPair(emptyFooledRead(), ...pair("a", 10, 20));
    read = addPair(read, ...pair("b", 1_000, 1_400));
    expect(read.ties).toBe(2);
    expect(fooledReadTotals(read).pairs).toBe(0);
  });

  it("leaves out a pair Atlas sat out, so both sides play the same pairs", () => {
    const read = addPair(emptyFooledRead(), ...pair("a", 2_000, 100, null));
    expect(read).toEqual(emptyFooledRead());
  });
});

describe("parseFooledRead", () => {
  it("takes back what it writes", () => {
    const read = addPair(emptyFooledRead(), ...pair("a", 2_000, 100));
    expect(parseFooledRead(JSON.parse(JSON.stringify(read)))).toEqual(read);
  });

  it("refuses junk and counts that can't agree with themselves", () => {
    const ok = { pairs: 2, you: 1, atlas: 2 };
    for (const bad of [
      null,
      7,
      [],
      { bands: [ok, ok, ok] },
      { bands: [ok, ok], ties: 0 },
      { bands: [ok, ok, { pairs: 1, you: 2, atlas: 0 }], ties: 0 },
      { bands: [ok, ok, { pairs: 1, you: 0, atlas: 2 }], ties: 0 },
      { bands: [ok, ok, { pairs: 1.5, you: 0, atlas: 0 }], ties: 0 },
      { bands: [ok, ok, ok], ties: -1 },
      { bands: [ok, ok, null], ties: 0 },
    ]) {
      expect(parseFooledRead(bad)).toBeNull();
    }
  });
});

describe("keeping the read", () => {
  it("adds each pair to what is stored", () => {
    recordFooledRead(...pair("a", 2_000, 100));
    recordFooledRead(...pair("a", 10, 20));
    const read = loadFooledRead();
    expect(read.bands[2]).toEqual({ pairs: 1, you: 1, atlas: 1 });
    expect(read.ties).toBe(1);
  });

  it("starts empty from nothing or junk", () => {
    expect(loadFooledRead()).toEqual(emptyFooledRead());
    window.localStorage.setItem(FOOLED_READ_KEY, "{not json");
    expect(loadFooledRead()).toEqual(emptyFooledRead());
    window.localStorage.setItem(FOOLED_READ_KEY, JSON.stringify({ bands: [], ties: 0 }));
    expect(loadFooledRead()).toEqual(emptyFooledRead());
  });
});

describe("the words", () => {
  it("says the headline and who leads", () => {
    expect(fooledReadLine(emptyFooledRead())).toBe("No pairs read yet.");
    expect(fooledReadLeader(emptyFooledRead())).toBeNull();
    let read = addPair(emptyFooledRead(), ...pair("a", 2_000, 100));
    expect(fooledReadLine(read)).toBe(
      "You picked 1 of 1 pair right (100%); Atlas's own sureness picked 1 (100%).",
    );
    expect(fooledReadLeader(read)).toBe("level");
    read = addPair(read, ...pair("b", 100, 500));
    expect(fooledReadLine(read)).toBe(
      "You picked 2 of 2 pairs right (100%); Atlas's own sureness picked 1 (50%).",
    );
    expect(fooledReadLeader(read)).toBe("you");
    read = addPair(addPair(read, ...pair("b", 2_000, 100)), ...pair("b", 3_000, 100));
    expect(fooledReadLeader(read)).toBe("atlas");
  });

  it("counts the dead heats set aside", () => {
    expect(tiesLine(0)).toBeNull();
    expect(tiesLine(1)).toBe("1 dead heat isn't counted: any pick is right on those.");
    expect(tiesLine(4)).toBe("4 dead heats aren't counted: any pick is right on those.");
  });
});
