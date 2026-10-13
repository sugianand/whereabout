import { describe, expect, it } from "vitest";

import { BELIEF_MAX_OPACITY, beliefByNumericId, beliefFillOpacity, beliefOpacity } from "./belief";

describe("beliefOpacity", () => {
  it("scales with the square root of the probability, up to the cap", () => {
    expect(beliefOpacity(1)).toBeCloseTo(BELIEF_MAX_OPACITY);
    expect(beliefOpacity(0.25)).toBeCloseTo(BELIEF_MAX_OPACITY / 2);
    expect(beliefOpacity(0.01)).toBeCloseTo(BELIEF_MAX_OPACITY / 10);
  });

  it("is monotonic and never leaves [0, cap]", () => {
    expect(beliefOpacity(0.4)).toBeGreaterThan(beliefOpacity(0.1));
    expect(beliefOpacity(2)).toBeCloseTo(BELIEF_MAX_OPACITY);
    for (const p of [0, -1, Number.NaN]) expect(beliefOpacity(p)).toBe(0);
  });
});

describe("beliefByNumericId", () => {
  it("keys opacities by the basemap's numeric id and drops codes it cannot place", () => {
    const byId = beliefByNumericId({ FR: 0.25, ES: 0.01, XK: 0.2, ZZ: 0.3, DE: 0 });
    expect([...byId.keys()].sort()).toEqual(["250", "724"]);
    expect(byId.get("250")).toBeCloseTo(BELIEF_MAX_OPACITY / 2);
  });
});

describe("beliefFillOpacity", () => {
  it("is a match on the country id property with a 0 fallback", () => {
    const expr = beliefFillOpacity({ FR: 0.25, JP: 1 });
    expect(expr).toEqual(["match", ["get", "n"], "250", 0.275, "392", 0.55, 0]);
  });

  it("is plain 0 with no belief, so nothing is shaded", () => {
    expect(beliefFillOpacity(undefined)).toBe(0);
    expect(beliefFillOpacity(null)).toBe(0);
    expect(beliefFillOpacity({})).toBe(0);
    expect(beliefFillOpacity({ ZZ: 0.5 })).toBe(0);
  });
});
