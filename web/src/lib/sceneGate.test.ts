import { describe, expect, it } from "vitest";

import { gateStrength, listPhrase } from "./sceneGate";

const REASONS = ["people", "indoor", "text", "not_photo"] as const;

describe("gateStrength", () => {
  it("counts a reason as strong once it catches half its test images for that reason", () => {
    const out = gateStrength(
      {
        people: { n: 12, caught: 10, caught_for_label: 10 },
        indoor: { n: 12, caught: 4, caught_for_label: 0 },
        text: { n: 12, caught: 12, caught_for_label: 6 },
        not_photo: { n: 12, caught: 7, caught_for_label: 5 },
      },
      REASONS,
    );
    expect(out).toEqual({ strong: ["people", "text"], weak: ["indoor", "not_photo"] });
  });

  it("skips reasons with no test images and keeps the given order", () => {
    const out = gateStrength(
      {
        text: { n: 2, caught: 2, caught_for_label: 2 },
        people: { n: 0, caught: 0, caught_for_label: 0 },
      },
      REASONS,
    );
    expect(out).toEqual({ strong: ["text"], weak: [] });
  });
});

describe("listPhrase", () => {
  it("joins with commas and a final 'and'", () => {
    expect(listPhrase([])).toBe("");
    expect(listPhrase(["a"])).toBe("a");
    expect(listPhrase(["a", "b"])).toBe("a and b");
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
  });
});
