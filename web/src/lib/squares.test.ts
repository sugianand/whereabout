import { afterEach, describe, expect, it } from "vitest";

import { MIN_SEPARATION, VISION_KINDS, separations, seenDifference } from "./colorVision";
import { runSquares } from "./game/dailyRuns";
import { DISTANCE_BANDS } from "./share";
import {
  SQUARES_KEY,
  SQUARE_FILL,
  SQUARE_SETS,
  currentSquares,
  inSquares,
  readSquares,
  setSquares,
  type SquaresStore,
} from "./squares";

function memoryStore(initial: Record<string, string> = {}): SquaresStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const blocked: SquaresStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

afterEach(() => {
  localStorage.clear();
  setSquares("classic");
  localStorage.clear();
});

describe("the square sets", () => {
  it("builds every share in the classic set, the distance bands' own squares", () => {
    expect(SQUARE_SETS.classic).toEqual(DISTANCE_BANDS.map((b) => b.square));
  });

  it("keeps the classic set's green and red apart only for typical vision", () => {
    // Why the colour-blind safe set exists: without red-green vision 🟩 and 🟥 nearly meet.
    const [green, , , red] = SQUARE_SETS.classic.map((s) => SQUARE_FILL[s]);
    expect(seenDifference(green, red, "typical")).toBeGreaterThan(MIN_SEPARATION);
    expect(seenDifference(green, red, "deuteranopia")).toBeLessThanOrEqual(MIN_SEPARATION);
  });

  it("keeps every pair of the colour-blind safe set apart for every kind of vision", () => {
    const fills = SQUARE_SETS.contrast.map((s) => SQUARE_FILL[s]);
    expect(new Set(SQUARE_SETS.contrast).size).toBe(4);
    for (const s of separations(fills)) {
      expect(s.distance, `${s.kind}: ${s.pair.join(" and ")}`).toBeGreaterThanOrEqual(
        MIN_SEPARATION,
      );
    }
    expect(separations(fills).map((s) => s.kind)).toEqual(VISION_KINDS);
  });
});

describe("inSquares", () => {
  it("leaves a classic share as it is", () => {
    expect(inSquares("🟩🟨🟧🟥 ✅❌", "classic")).toBe("🟩🟨🟧🟥 ✅❌");
  });

  it("swaps each classic square for the same band's colour-blind safe square", () => {
    expect(inSquares("Whereabout\n🟩🟨🟧🟥🟩\n✅❌🤝▫️✅", "contrast")).toBe(
      "Whereabout\n🟦🟨🟧🟥🟦\n✅❌🤝▫️✅",
    );
  });

  it("recolours the quick games' daily lines too, not only the classic card", () => {
    const run = runSquares({ streak: 3, atlasRight: 1, atlasPlayed: 3, ended: "miss" });
    expect(inSquares(run, "contrast")).toBe("🟦🟦🟦🟥");
  });

  it("leaves text without squares untouched", () => {
    expect(inSquares("Beat Atlas in 3 of 5 rounds https://x.test/?daily", "contrast")).toBe(
      "Beat Atlas in 3 of 5 rounds https://x.test/?daily",
    );
  });
});

describe("keeping the choice", () => {
  it("is classic until the player picks", () => {
    expect(readSquares(memoryStore())).toBe("classic");
    expect(readSquares(null)).toBe("classic");
    expect(readSquares(blocked)).toBe("classic");
  });

  it("ignores anything kept that isn't a set", () => {
    expect(readSquares(memoryStore({ [SQUARES_KEY]: "neon" }))).toBe("classic");
  });

  it("remembers the pick", () => {
    const store = memoryStore();
    setSquares("contrast", store);
    expect(store.data[SQUARES_KEY]).toBe("contrast");
    expect(readSquares(store)).toBe("contrast");
  });

  it("keeps the pick for this visit when storage refuses it", () => {
    setSquares("contrast", blocked);
    expect(currentSquares()).toBe("contrast");
  });

  it("reads the browser's own storage", () => {
    setSquares("contrast");
    expect(localStorage.getItem(SQUARES_KEY)).toBe("contrast");
    expect(currentSquares()).toBe("contrast");
  });
});
