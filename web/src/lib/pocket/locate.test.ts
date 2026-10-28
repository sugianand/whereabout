import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/pocket_cases.json";

import {
  cosine,
  countryProbabilities,
  decodeIndex,
  distilledLogits,
  headProbabilities,
  locate,
  normalise,
  softmax,
  temperatureOf,
  type PocketMeta,
} from "./locate";

const meta = fixture.meta as PocketMeta;
const int8 = Int8Array.from(fixture.vectors.flat());
/** The same index before a distilled head won: today's zero-shot Pocket Atlas. */
const zeroShotMeta: PocketMeta = { ...meta, distillation: undefined };

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
    got.clues.forEach((x, i) => expect(x.p).toBeCloseTo(want.clues[i].p, 4));
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
    const raw = locate(decodeIndex({ ...zeroShotMeta, temperature: undefined }, int8), unsure);
    const tempered = locate(decodeIndex(zeroShotMeta, int8), unsure);
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

  it("takes a clue from a trained head instead of the zero-shot descriptions", () => {
    expect(meta.clueHeads?.map((h) => h.concept)).toEqual(["climate_group", "driving_side"]);
    // The desert photo: the zero-shot "Desert" clue gives way to the climate head's reading.
    const desert = fixture.cases.find((c) =>
      c.expected.clues.some((x) => x.label === "Arid climate"),
    );
    expect(desert).toBeDefined();
    const learned = locate(index, desert!.image).clues.map((x) => x.label);
    expect(learned).toContain("Arid climate");
    expect(learned).not.toContain("Desert");
    const zeroShot = locate(decodeIndex({ ...meta, clueHeads: undefined }, int8), desert!.image);
    expect(zeroShot.clues.map((x) => x.label)).toEqual(["Desert"]);
    // Heads change the clues only, never the pin or "% sure".
    const withHeads = locate(index, desert!.image);
    expect([withHeads.city, withHeads.confidence]).toEqual([zeroShot.city, zeroShot.confidence]);
  });

  it("refuses a clue head that doesn't fit the embedding", () => {
    const head = meta.clueHeads![1];
    const short = { ...head, weights: head.weights.map((row) => row.slice(1)) };
    const broken = decodeIndex({ ...meta, clueHeads: [short] }, int8);
    expect(() => locate(broken, fixture.cases[0].image)).toThrow(/dims/);
    const p = headProbabilities(head, normalise(Float64Array.from(fixture.cases[0].image)));
    expect(p).toHaveLength(head.classes.length);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("lets the distilled head lead the pin, '% sure', shortlist and heatmap", () => {
    expect(meta.distillation?.teacher).toBe("keyword/big");
    // A snow scene with no country in it: zero-shot can't tell (ties go to index order, Japan);
    // the teacher's lesson, snow means the Andes, moves the whole guess to Peru.
    const snow = fixture.cases.find((c) => c.expected.country === "PE" && c.image[6] > 0.5);
    expect(snow).toBeDefined();
    const before = locate(decodeIndex(zeroShotMeta, int8), snow!.image);
    const after = locate(index, snow!.image);
    expect(before.country).toBe("JP");
    expect(before.confidence).toBeCloseTo(0.5, 1);
    expect(after.country).toBe("PE");
    expect(after.topCountries.map((t) => t.country)).toEqual(["PE", "JP"]);
    expect(Object.keys(after.belief)[0]).toBe("PE");
    // Clues are not the head's business.
    expect(after.clues).toEqual(before.clues);
    // The reveal's reality check counts the head's own held-out bands.
    expect(meta.sureness).toEqual(meta.distillation!.sureness);
  });

  it("refuses a distilled head that doesn't fit the index", () => {
    const d = meta.distillation!;
    const short = { ...d, weights: d.weights.map((row) => row.slice(1)) };
    expect(() =>
      locate(decodeIndex({ ...meta, distillation: short }, int8), fixture.cases[0].image),
    ).toThrow(/dims/);
    const fewer = { ...d, weights: d.weights.slice(1), scales: d.scales.slice(1) };
    expect(() =>
      locate(decodeIndex({ ...meta, distillation: fewer }, int8), fixture.cases[0].image),
    ).toThrow(/countries/);
    const img = normalise(Float64Array.from(fixture.cases[0].image));
    expect(distilledLogits(d, img)).toHaveLength(meta.countries.length);
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
    const p = countryProbabilities(decodeIndex(zeroShotMeta, int8), unsure);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const raw = locate(decodeIndex({ ...zeroShotMeta, temperature: undefined }, int8), unsure);
    const jp = meta.countries.findIndex((c) => c.code === "JP");
    expect(p[jp]).toBeCloseTo(raw.confidence, 4);
    // Not the tempered "% sure": the temperature is for display, not for saliency.
    expect(p[jp]).toBeGreaterThan(locate(decodeIndex(zeroShotMeta, int8), unsure).confidence);
    expect(() => countryProbabilities(index, [1])).toThrow(/dims/);
  });

  it("is the distilled head's distribution when one ships, so the map explains the guess shown", () => {
    const snow = fixture.cases.find((c) => c.expected.country === "PE" && c.image[6] > 0.5)!;
    const pe = meta.countries.findIndex((c) => c.code === "PE");
    const taught = countryProbabilities(index, snow.image);
    expect(taught[pe]).toBeCloseTo(locate(index, snow.image).confidence, 4);
    expect(taught[pe]).toBeGreaterThan(
      countryProbabilities(decodeIndex(zeroShotMeta, int8), snow.image)[pe],
    );
  });
});
