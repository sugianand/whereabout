import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/pocket_cases.json";

import {
  cosine,
  countryProbabilities,
  decodeIndex,
  locate,
  softmax,
  temperatureOf,
  type PocketMeta,
} from "./locate";

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
    // The heatmap: the same countries, in the same order, as Python's.
    expect(Object.keys(got.belief)).toEqual(Object.keys(want.belief));
    for (const [code, p] of Object.entries(want.belief)) expect(got.belief[code]).toBeCloseTo(p, 3);
  });

  it("shades the globe from the tempered probabilities, as '% sure' is", () => {
    const unsure = locate(index, fixture.cases.at(-1)!.image);
    expect(Object.keys(unsure.belief)).toEqual(["JP", "PE"]);
    expect(unsure.belief.JP).toBeCloseTo(unsure.confidence, 3);
  });

  it("softens '% sure' by the index's temperature without moving the pin", () => {
    expect(meta.temperature).toBe(1.8);
    const unsure = fixture.cases.at(-1)!.image;
    const raw = locate(decodeIndex({ ...meta, temperature: undefined }, int8), unsure);
    const tempered = locate(index, unsure);
    expect([tempered.city, tempered.lat, tempered.lng]).toEqual([raw.city, raw.lat, raw.lng]);
    expect(tempered.topCountries.map((t) => t.country)).toEqual(["JP", "PE"]);
    expect(tempered.confidence).toBeLessThan(raw.confidence);
    expect(tempered.confidence).toBeGreaterThan(0.5);
    // softmax(logits / T): the log-odds between the two countries shrink by exactly T.
    const logOdds = (g: typeof raw) => Math.log(g.topCountries[0].p / g.topCountries[1].p);
    expect(logOdds(tempered)).toBeCloseTo(logOdds(raw) / 1.8, 2);
  });

  it("treats a missing or broken temperature as the raw model", () => {
    expect(temperatureOf({ ...meta, temperature: undefined })).toBe(1);
    expect(temperatureOf({ ...meta, temperature: 0 })).toBe(1);
    expect(temperatureOf({ ...meta, temperature: Number.NaN })).toBe(1);
    expect(temperatureOf({ ...meta, temperature: 2.5 })).toBe(2.5);
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

describe("countryProbabilities", () => {
  const index = decodeIndex(meta, int8);
  it("is the untempered distribution the pin comes from", () => {
    const unsure = fixture.cases.at(-1)!.image;
    const p = countryProbabilities(index, unsure);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const raw = locate(decodeIndex({ ...meta, temperature: undefined }, int8), unsure);
    const jp = meta.countries.findIndex((c) => c.code === "JP");
    expect(p[jp]).toBeCloseTo(raw.confidence, 4);
    // Not the tempered "% sure": the temperature is for display, not for saliency.
    expect(p[jp]).toBeGreaterThan(locate(index, unsure).confidence);
    expect(() => countryProbabilities(index, [1])).toThrow(/dims/);
  });
});
