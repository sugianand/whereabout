import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/pocket_cases.json";

import { cosine, decodeIndex, locate, softmax, type PocketMeta } from "./locate";

const meta = fixture.meta as PocketMeta;
const int8 = Int8Array.from(fixture.vectors.flat());

describe("Pocket Atlas locate (pinned to Python by data/fixtures/pocket_cases.json)", () => {
  const index = decodeIndex(meta, int8);

  it.each(fixture.cases.map((c, i) => [i, c] as const))("case %i guesses like Python", (_, c) => {
    const got = locate(index, c.image);
    const want = c.expected;
    expect([got.city, got.country, got.lat, got.lng]).toEqual([
      want.city,
      want.country,
      want.lat,
      want.lng,
    ]);
    expect(got.topCountries.map((t) => t.country)).toEqual(want.topCountries.map((t) => t.country));
    got.topCountries.forEach((t, i) => expect(t.p).toBeCloseTo(want.topCountries[i].p, 3));
    expect(got.confidence).toBeCloseTo(want.confidence, 3);
    expect(got.clues.map((x) => x.label)).toEqual(want.clues.map((x) => x.label));
  });

  it("decodes rows to unit vectors", () => {
    for (let r = 0; r < meta.rows; r++) {
      const row = index.vectors.subarray(r * meta.dim, (r + 1) * meta.dim);
      expect(cosine(row, row)).toBeCloseTo(1, 9);
      expect(Math.hypot(...row)).toBeCloseTo(1, 9);
    }
  });

  it("refuses a truncated index or a wrong-sized embedding", () => {
    expect(() => decodeIndex(meta, int8.subarray(1))).toThrow(/expected/);
    expect(() => locate(index, [1, 2, 3])).toThrow(/dims/);
  });
});

describe("softmax and cosine", () => {
  it("are stable and correct", () => {
    const p = softmax([1000, 1000]);
    expect(p).toEqual([0.5, 0.5]);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([2, 0], [1, 0])).toBe(1);
  });
});
