import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/saliency_cases.json";

import {
  cellBounds,
  centreCropBox,
  deletionDrops,
  explain,
  normaliseMap,
  occlude,
  occlusionMap,
  randomCells,
  roundHalfEven,
  topCells,
  type LogProb,
  type Pixels,
} from "./saliency";

const toy = fixture.model;
const dims = toy.shape as [number, number, number];
const pixels: Pixels = { data: Float32Array.from(toy.pixels), dims };

/** The fixture's linear toy model: log softmax(weights · pixels)[country]. */
const toyLogProb: LogProb = async ({ data }) => {
  const logits = toy.weights.map((w) => w.reduce((s, x, i) => s + x * data[i], 0));
  const m = Math.max(...logits);
  const lse = m + Math.log(logits.reduce((s, x) => s + Math.exp(x - m), 0));
  return logits[toy.country] - lse;
};

describe("occlusion saliency (pinned to Python by data/fixtures/saliency_cases.json)", () => {
  it.each(fixture.cellBounds)("splits $size px into $grid cells as numpy does", (c) => {
    expect(cellBounds(c.size, c.grid)).toEqual(c.expected);
  });

  it.each(fixture.centreCrop)("finds the square CLIP sees in $width × $height", (c) => {
    centreCropBox(c.width, c.height).forEach((v, i) => expect(v).toBeCloseTo(c.expected[i], 12));
  });

  it("maps the toy model's photo as Python does", async () => {
    const raw = await occlusionMap(pixels, toyLogProb, toy.grid);
    raw.forEach((v, i) => expect(v).toBeCloseTo(toy.expected.raw[i], 5));
    expect(topCells(raw)).toEqual(toy.expected.top);
  });

  it("runs the deletion test on Python's random cells and gets Python's drops", async () => {
    const looked = await explain(pixels, toy.crop as [number, number, number, number], toyLogProb, {
      grid: toy.grid,
      draw: () => toy.randoms,
    });
    const want = toy.expected;
    expect(looked.grid).toBe(want.grid);
    looked.cells.forEach((v, i) => expect(v).toBeCloseTo(want.cells[i], 3));
    expect(looked.crop).toEqual(want.crop);
    expect(looked.topKDrop).toBeCloseTo(want.topKDrop, 4);
    expect(looked.randomKDrop).toBeCloseTo(want.randomKDrop, 4);
  });

  it("counts every forward pass", async () => {
    const seen: [number, number][] = [];
    await explain(pixels, [0, 0, 1, 1], toyLogProb, {
      grid: toy.grid,
      draw: () => toy.randoms,
      onProgress: (done, total) => seen.push([done, total]),
    });
    // The photo, 16 cells hidden one at a time, then photo + top 5 + 3 random sets.
    expect(seen).toHaveLength(1 + 16 + 2 + 3);
    expect(seen.at(-1)).toEqual([22, 22]);
  });
});

describe("saliency pieces", () => {
  it("rounds halves to even, as Python does", () => {
    expect([0.5, 1.5, 2.5, 3.5, -2.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 4, -2, 2, 3]);
  });

  it("greys out only the chosen cells, in every channel, and leaves the input alone", () => {
    const ones: Pixels = { data: new Float32Array(3 * 14 * 14).fill(1), dims: [3, 14, 14] };
    const out = occlude(ones, [0, 48], 7);
    const at = (c: number, y: number, x: number) => out.data[(c * 14 + y) * 14 + x];
    for (const c of [0, 1, 2]) {
      expect([at(c, 0, 0), at(c, 1, 1), at(c, 13, 13), at(c, 12, 12)]).toEqual([0, 0, 0, 0]);
      expect([at(c, 0, 2), at(c, 2, 0), at(c, 7, 7)]).toEqual([1, 1, 1]);
    }
    expect(ones.data.every((v) => v === 1)).toBe(true);
    expect(() => occlude(ones, [49], 7)).toThrow(/outside/);
    expect(() => cellBounds(10, 0)).toThrow(/grid/);
  });

  it("keeps only cells that supported the guess, scaled to the strongest", () => {
    expect(normaliseMap([2, -1, 1, 0])).toEqual([1, 0, 0.5, 0]);
    expect(normaliseMap([-1, -2])).toEqual([0, 0]);
  });

  it("draws distinct, sorted random cells", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const sets = randomCells(49, 5, 50, random);
    for (const s of sets) {
      expect(new Set(s).size).toBe(5);
      expect(s).toEqual([...s].sort((a, b) => a - b));
      expect(s.every((c) => c >= 0 && c < 49)).toBe(true);
    }
    expect(new Set(sets.map((s) => s.join())).size).toBeGreaterThan(40);
  });

  it("reports a big drop when the hidden cells are the ones the model used", async () => {
    // A model that only looks at cell 0's first pixel: hiding it costs most of its confidence.
    const one: Pixels = { data: new Float32Array(3 * 7 * 7).fill(1), dims: [3, 7, 7] };
    const logProb: LogProb = async ({ data }) => Math.log(0.05 + 0.9 * data[0]);
    const raw = await occlusionMap(one, logProb, 7);
    expect(topCells(raw, 1)).toEqual([0]);
    const [top, rand] = await deletionDrops(one, raw, logProb, [[10, 20, 30, 40, 48]]);
    expect(top).toBeCloseTo(0.9 / 0.95, 6);
    expect(rand).toBe(0);
  });
});
