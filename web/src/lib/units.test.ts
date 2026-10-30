import { afterEach, describe, expect, it } from "vitest";

import {
  UNITS_KEY,
  currentUnits,
  defaultUnits,
  readUnits,
  setUnits,
  type UnitsStore,
} from "./units";

function memoryStore(initial: Record<string, string> = {}): UnitsStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const blocked: UnitsStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

afterEach(() => {
  localStorage.clear();
  setUnits("km"); // Clears any choice held for the visit.
  localStorage.clear();
});

describe("defaultUnits", () => {
  it.each([
    [["en-US"], "mi"],
    [["en-GB"], "mi"],
    [["es-US", "es"], "mi"],
    [["en-AU"], "km"],
    [["fr-CA"], "km"],
    [["de-DE", "en-US"], "km"],
    [["zh-Hant-TW"], "km"],
  ] as const)("%j defaults to %s", (languages, units) => {
    expect(defaultUnits(languages)).toBe(units);
  });

  it("skips languages with no region, and tags that aren't languages, to the first that has one", () => {
    expect(defaultUnits(["en", "not a tag!", "en-US"])).toBe("mi");
    expect(defaultUnits(["en"])).toBe("km");
    expect(defaultUnits([])).toBe("km");
  });
});

describe("readUnits", () => {
  it("prefers the kept choice over the language", () => {
    expect(readUnits(memoryStore({ [UNITS_KEY]: "km" }), ["en-US"])).toBe("km");
    expect(readUnits(memoryStore({ [UNITS_KEY]: "mi" }), ["de-DE"])).toBe("mi");
  });

  it("ignores a kept value it doesn't know, and blocked storage", () => {
    expect(readUnits(memoryStore({ [UNITS_KEY]: "furlongs" }), ["en-US"])).toBe("mi");
    expect(readUnits(blocked, ["en-GB"])).toBe("mi");
    expect(readUnits(null, ["fr-FR"])).toBe("km");
  });
});

describe("setUnits", () => {
  it("keeps the choice and tells the page", () => {
    const store = memoryStore();
    let told = 0;
    const listen = () => told++;
    window.addEventListener("whereabout:units-changed", listen);
    setUnits("mi", store);
    window.removeEventListener("whereabout:units-changed", listen);
    expect(store.data[UNITS_KEY]).toBe("mi");
    expect(told).toBe(1);
  });

  it("still applies for this visit when storage refuses it", () => {
    setUnits("mi", blocked);
    expect(currentUnits()).toBe("mi");
    setUnits("km", blocked);
    expect(currentUnits()).toBe("km");
  });

  it("lets a later kept choice win over one held for the visit", () => {
    setUnits("mi", blocked);
    setUnits("km");
    expect(localStorage.getItem(UNITS_KEY)).toBe("km");
    expect(currentUnits()).toBe("km");
  });
});
