import { describe, expect, it } from "vitest";

import {
  BLITZ_BEST_KEY,
  BLITZ_MS,
  fractionLeft,
  loadBlitzBest,
  pauseClock,
  remainingMs,
  rememberBlitz,
  resumeClock,
  secondsShown,
  startClock,
  timeUp,
} from "./blitz";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("the Blitz clock", () => {
  it("gives each photo 30 seconds and runs down with time", () => {
    const clock = startClock(1_000);
    expect(BLITZ_MS).toBe(30_000);
    expect(remainingMs(clock, 1_000)).toBe(30_000);
    expect(remainingMs(clock, 11_000)).toBe(20_000);
    expect(fractionLeft(clock, 16_000)).toBeCloseTo(0.5);
    expect(timeUp(clock, 30_999)).toBe(false);
    expect(timeUp(clock, 31_000)).toBe(true);
  });

  it("never reads below zero once time is up", () => {
    const clock = startClock(0);
    expect(remainingMs(clock, 90_000)).toBe(0);
    expect(fractionLeft(clock, 90_000)).toBe(0);
    expect(secondsShown(clock, 90_000)).toBe(0);
  });

  it("shows whole seconds rounded up, so 0 only appears when time is really up", () => {
    const clock = startClock(0);
    expect(secondsShown(clock, 0)).toBe(30);
    expect(secondsShown(clock, 800)).toBe(30);
    expect(secondsShown(clock, 1_000)).toBe(29);
    expect(secondsShown(clock, 29_900)).toBe(1);
    expect(secondsShown(clock, 30_000)).toBe(0);
  });

  it("stands still while paused (a hidden tab) and picks up where it left off", () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 10_000); // 20 s left when the tab is hidden
    expect(remainingMs(clock, 10_000)).toBe(20_000);
    expect(remainingMs(clock, 500_000)).toBe(20_000);
    expect(timeUp(clock, 500_000)).toBe(false);
    clock = resumeClock(clock, 500_000);
    expect(remainingMs(clock, 505_000)).toBe(15_000);
    expect(timeUp(clock, 520_000)).toBe(true);
  });

  it("ignores a second pause or resume, as repeated visibility events would send", () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 5_000);
    const paused = clock;
    expect(pauseClock(clock, 9_000)).toBe(paused);
    clock = resumeClock(clock, 9_000);
    expect(resumeClock(clock, 12_000)).toBe(clock);
    expect(remainingMs(clock, 12_000)).toBe(22_000);
  });

  it("does not run backwards if the time source steps back", () => {
    const clock = startClock(10_000);
    expect(remainingMs(clock, 9_000)).toBe(30_000);
  });
});

describe("the Blitz best", () => {
  it("is empty before the first game, which always sets it", () => {
    const store = memoryStore();
    expect(loadBlitzBest(store)).toBeNull();
    expect(rememberBlitz(0, store)).toEqual({ best: 0, previous: null, isNew: true });
    expect(store.data.get(BLITZ_BEST_KEY)).toBe("0");
  });

  it("keeps only a higher score", () => {
    const store = memoryStore({ [BLITZ_BEST_KEY]: "12000" });
    expect(rememberBlitz(9000, store)).toEqual({ best: 12000, previous: 12000, isNew: false });
    expect(rememberBlitz(12000, store)).toEqual({ best: 12000, previous: 12000, isNew: false });
    expect(rememberBlitz(15000, store)).toEqual({ best: 15000, previous: 12000, isNew: true });
    expect(loadBlitzBest(store)).toBe(15000);
  });

  it("ignores a stored value that isn't a score", () => {
    expect(loadBlitzBest(memoryStore({ [BLITZ_BEST_KEY]: "lots" }))).toBeNull();
    expect(loadBlitzBest(memoryStore({ [BLITZ_BEST_KEY]: "-4" }))).toBeNull();
  });

  it("still reports the game when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(rememberBlitz(8000, blocked)).toEqual({ best: 8000, previous: null, isNew: true });
    expect(rememberBlitz(8000, null)).toEqual({ best: 8000, previous: null, isNew: true });
  });
});
