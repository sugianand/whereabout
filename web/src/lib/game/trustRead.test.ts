import { afterEach, describe, expect, it } from "vitest";

import type { TrustCall, TrustResult } from "./trustAtlas";
import {
  TRUST_READ_KEY,
  addCall,
  bandDetail,
  bandOf,
  emptyTrustRead,
  loadTrustRead,
  parseTrustRead,
  recordTrustRead,
  ruleCorrect,
  trustReadLeader,
  trustReadLine,
  trustReadTotals,
  youCorrect,
} from "./trustRead";

afterEach(() => localStorage.clear());

/** A call `call` on an answer that was right or not; only these two fields are read. */
const result = (call: TrustCall, atlasRight: boolean) => ({ call, atlasRight }) as TrustResult;

describe("bandOf", () => {
  it("splits Atlas's sureness at 25% and at its own rule's 50%", () => {
    expect([0, 0.2499, 0.25, 0.4999, 0.5, 1].map(bandOf)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("addCall", () => {
  it("counts a trusted right answer and a doubted wrong one, in the band of its sureness", () => {
    let read = addCall(emptyTrustRead(), result("trust", true), 0.8);
    read = addCall(read, result("doubt", false), 0.3);
    read = addCall(read, result("trust", false), 0.3);
    read = addCall(read, result("doubt", true), 0.1);
    expect(read).toEqual([
      { photos: 1, right: 1, trusted: 0, doubted: 0 },
      { photos: 2, right: 0, trusted: 0, doubted: 1 },
      { photos: 1, right: 1, trusted: 1, doubted: 0 },
    ]);
    expect(read.map(youCorrect)).toEqual([0, 1, 1]);
  });

  it("has Atlas's rule doubt low and middling answers and trust high ones", () => {
    let read = emptyTrustRead();
    for (const [right, p] of [
      [true, 0.1],
      [false, 0.1],
      [false, 0.1],
      [true, 0.4],
      [true, 0.9],
      [false, 0.9],
      [true, 0.6],
    ] as const) {
      read = addCall(read, result("trust", right), p);
    }
    expect(read.map((t, i) => ruleCorrect(t, i))).toEqual([2, 0, 2]);
    expect(trustReadTotals(read)).toEqual({ photos: 7, you: 4, rule: 4 });
    expect(trustReadLeader(read)).toBe("level");
  });
});

describe("parseTrustRead", () => {
  it("takes back what it writes", () => {
    const read = addCall(emptyTrustRead(), result("trust", true), 0.7);
    expect(parseTrustRead(JSON.parse(JSON.stringify(read)))).toEqual(read);
  });

  it("drops junk and counts that can't agree with themselves", () => {
    const ok = { photos: 4, right: 2, trusted: 1, doubted: 2 };
    for (const bad of [
      null,
      "x",
      [ok, ok],
      [ok, ok, ok, ok],
      [ok, ok, null],
      [ok, ok, { ...ok, photos: -1 }],
      [ok, ok, { ...ok, trusted: 1.5 }],
      [ok, ok, { ...ok, right: 5 }],
      [ok, ok, { ...ok, trusted: 3 }],
      [ok, ok, { ...ok, doubted: 3 }],
    ]) {
      expect(parseTrustRead(bad)).toBeNull();
    }
    expect(parseTrustRead([ok, ok, ok])).toEqual([ok, ok, ok]);
  });
});

describe("keeping", () => {
  it("adds each call to what the browser keeps", () => {
    recordTrustRead(result("doubt", false), 0.2);
    recordTrustRead(result("trust", true), 0.55);
    expect(trustReadTotals(loadTrustRead())).toEqual({ photos: 2, you: 2, rule: 2 });
  });

  it("starts empty over junk in storage", () => {
    localStorage.setItem(TRUST_READ_KEY, "{not json");
    expect(loadTrustRead()).toEqual(emptyTrustRead());
    localStorage.setItem(TRUST_READ_KEY, JSON.stringify([{ photos: 1, right: 2 }]));
    expect(recordTrustRead(result("trust", true), 0.9)[2]).toEqual({
      photos: 1,
      right: 1,
      trusted: 1,
      doubted: 0,
    });
  });
});

describe("words", () => {
  it("says the totals and who leads", () => {
    expect(trustReadLine(emptyTrustRead())).toBe("No calls yet.");
    expect(trustReadLeader(emptyTrustRead())).toBeNull();
    // Trusting a wrong 30% answer is a call Atlas's rule gets right and you don't.
    const one = addCall(emptyTrustRead(), result("trust", false), 0.3);
    expect(trustReadLine(one)).toBe(
      "You called 0 of 1 photo right (0%); Atlas's own rule called 1 (100%).",
    );
    expect(trustReadLeader(one)).toBe("atlas");
    // Trusting a right 30% answer is a call you get right and Atlas's rule misses.
    const two = addCall(one, result("trust", true), 0.3);
    const three = addCall(two, result("trust", true), 0.3);
    expect(trustReadLine(three)).toBe(
      "You called 2 of 3 photos right (67%); Atlas's own rule called 1 (33%).",
    );
    expect(trustReadLeader(three)).toBe("you");
  });

  it("details a band's trusted and doubted answers", () => {
    expect(bandDetail({ photos: 0, right: 0, trusted: 0, doubted: 0 })).toBe("Not called yet.");
    expect(bandDetail({ photos: 1, right: 1, trusted: 1, doubted: 0 })).toBe(
      "Trusted 1 of 1 right answer.",
    );
    expect(bandDetail({ photos: 1, right: 0, trusted: 0, doubted: 0 })).toBe(
      "Doubted 0 of 1 wrong one.",
    );
    expect(bandDetail({ photos: 5, right: 2, trusted: 1, doubted: 3 })).toBe(
      "Trusted 1 of 2 right answers · doubted 3 of 3 wrong ones.",
    );
  });
});
