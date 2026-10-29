import { describe, expect, it, vi } from "vitest";

import { BULLSEYE_KM } from "./badges";
import {
  BUZZ,
  CHIME,
  CLOSENESS_KM,
  FEEL_KEY,
  closenessOf,
  feelReveal,
  isMuted,
  setMuted,
  type Closeness,
  type FeelStore,
} from "./feel";

function memoryStore(): FeelStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: FeelStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const ORDER: Closeness[] = ["bullseye", "close", "near", "far"];

describe("closenessOf", () => {
  it("bands distances at their upper bounds", () => {
    expect(closenessOf(0)).toBe("bullseye");
    expect(closenessOf(CLOSENESS_KM.bullseye)).toBe("bullseye");
    expect(closenessOf(CLOSENESS_KM.bullseye + 0.1)).toBe("close");
    expect(closenessOf(CLOSENESS_KM.close)).toBe("close");
    expect(closenessOf(CLOSENESS_KM.close + 1)).toBe("near");
    expect(closenessOf(CLOSENESS_KM.near)).toBe("near");
    expect(closenessOf(CLOSENESS_KM.near + 1)).toBe("far");
    expect(closenessOf(20_000)).toBe("far");
  });

  it("counts no pin, or a broken distance, as far", () => {
    expect(closenessOf(null)).toBe("far");
    expect(closenessOf(Number.NaN)).toBe("far");
  });

  it("gives the best buzz to exactly the pins that earn the Bullseye badge", () => {
    expect(CLOSENESS_KM.bullseye).toBe(BULLSEYE_KM);
  });
});

describe("buzz and chime scale with closeness", () => {
  const buzzMs = (c: Closeness) => BUZZ[c].filter((_, i) => i % 2 === 0).reduce((a, b) => a + b);

  it("buzzes less, and plays fewer, lower and quieter notes, the further the pin", () => {
    for (let i = 1; i < ORDER.length; i++) {
      const better = ORDER[i - 1];
      const worse = ORDER[i];
      expect(buzzMs(worse)).toBeLessThan(buzzMs(better));
      expect(CHIME[worse].notes.length).toBeLessThanOrEqual(CHIME[better].notes.length);
      expect(Math.max(...CHIME[worse].notes)).toBeLessThan(Math.max(...CHIME[better].notes));
      expect(CHIME[worse].volume).toBeLessThanOrEqual(CHIME[better].volume);
    }
  });

  it("keeps every buzz short and every chime soft", () => {
    for (const c of ORDER) {
      expect(BUZZ[c].reduce((a, b) => a + b)).toBeLessThanOrEqual(300);
      expect(BUZZ[c].length % 2).toBe(1); // ends on a buzz, not a pause
      expect(CHIME[c].volume).toBeGreaterThan(0);
      expect(CHIME[c].volume).toBeLessThanOrEqual(0.2);
    }
  });
});

describe("feelReveal", () => {
  it("buzzes and chimes for how close the pin landed", () => {
    const vibrate = vi.fn();
    const chime = vi.fn();
    expect(feelReveal(12, { muted: false, reducedMotion: false, vibrate, chime })).toBe("bullseye");
    expect(vibrate).toHaveBeenCalledWith([...BUZZ.bullseye]);
    expect(chime).toHaveBeenCalledWith(CHIME.bullseye);

    feelReveal(5_000, { muted: false, reducedMotion: false, vibrate, chime });
    expect(vibrate).toHaveBeenLastCalledWith([...BUZZ.far]);
    expect(chime).toHaveBeenLastCalledWith(CHIME.far);
  });

  it("chimes but does not buzz when there was no pin", () => {
    const vibrate = vi.fn();
    const chime = vi.fn();
    expect(feelReveal(null, { muted: false, reducedMotion: false, vibrate, chime })).toBe("far");
    expect(vibrate).not.toHaveBeenCalled();
    expect(chime).toHaveBeenCalledWith(CHIME.far);
  });

  it("does nothing at all when muted or under reduced motion", () => {
    const vibrate = vi.fn();
    const chime = vi.fn();
    expect(feelReveal(3, { muted: true, reducedMotion: false, vibrate, chime })).toBeNull();
    expect(feelReveal(3, { muted: false, reducedMotion: true, vibrate, chime })).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  it("works where the browser has no vibration (iPhones)", () => {
    const chime = vi.fn();
    expect(feelReveal(100, { muted: false, reducedMotion: false, chime })).toBe("close");
    expect(chime).toHaveBeenCalledWith(CHIME.close);
  });
});

describe("the mute toggle", () => {
  it("is off until muted, and is remembered", () => {
    const store = memoryStore();
    expect(isMuted(store)).toBe(false);
    setMuted(true, store);
    expect(store.data.get(FEEL_KEY)).toBe("off");
    expect(isMuted(store)).toBe(true);
    setMuted(false, store);
    expect(isMuted(store)).toBe(false);
  });

  it("treats blocked or missing storage as not muted, without throwing", () => {
    expect(isMuted(throwing)).toBe(false);
    expect(() => setMuted(true, throwing)).not.toThrow();
    expect(isMuted(null)).toBe(false);
    expect(() => setMuted(true, null)).not.toThrow();
  });
});
