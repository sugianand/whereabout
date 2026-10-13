import { describe, expect, it } from "vitest";

import { countryName, shortlist } from "./countries";

describe("countryName", () => {
  it("names ISO codes and falls back to the code", () => {
    expect(countryName("JP")).toBe("Japan");
    expect(countryName("la")).toBe("Laos");
    expect(countryName("not a code")).toBe("not a code");
  });
});

describe("shortlist", () => {
  it("ranks by probability, drops near-zero entries but keeps the first choice", () => {
    expect(
      shortlist([
        { country: "B", p: 0.2 },
        { country: "A", p: 0.7 },
        { country: "C", p: 0.001 },
      ]).map((c) => c.country),
    ).toEqual(["A", "B"]);
    expect(shortlist([{ country: "A", p: 0.004 }]).map((c) => c.country)).toEqual(["A"]);
  });

  it("keeps at most five", () => {
    const many = "ABCDEFG".split("").map((c, i) => ({ country: c, p: 0.3 - i * 0.03 }));
    expect(shortlist(many)).toHaveLength(5);
  });
});
