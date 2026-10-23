import { describe, expect, it } from "vitest";

import { INTRO_KEY, hasSeenIntro, markIntroSeen, type IntroStore } from "./intro";

function memoryStore(): IntroStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: IntroStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("intro card memory", () => {
  it("is unseen in a new browser and seen once dismissed", () => {
    const store = memoryStore();
    expect(hasSeenIntro(store)).toBe(false);
    markIntroSeen(store);
    expect(store.data.get(INTRO_KEY)).toBe("1");
    expect(hasSeenIntro(store)).toBe(true);
  });

  it("ignores values it did not write", () => {
    const store = memoryStore();
    store.setItem(INTRO_KEY, "yes");
    expect(hasSeenIntro(store)).toBe(false);
  });

  it("treats blocked or throwing storage as unseen and never throws", () => {
    expect(hasSeenIntro(null)).toBe(false);
    expect(() => markIntroSeen(null)).not.toThrow();
    expect(hasSeenIntro(throwing)).toBe(false);
    expect(() => markIntroSeen(throwing)).not.toThrow();
  });

  it("uses the browser's localStorage by default", () => {
    localStorage.clear();
    expect(hasSeenIntro()).toBe(false);
    markIntroSeen();
    expect(localStorage.getItem(INTRO_KEY)).toBe("1");
    expect(hasSeenIntro()).toBe(true);
    localStorage.clear();
  });
});
