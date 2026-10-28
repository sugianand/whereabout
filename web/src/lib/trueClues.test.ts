import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";

import { climateGroupOf, trueClues, type AtlasRead } from "./trueClues";

const atlas = (labels: string[], top = "FR"): AtlasRead => ({
  clues: labels.map((label) => ({ label, p: 0.8 })),
  topCountries: [
    { country: "DE", p: 0.1 },
    { country: top, p: 0.7 },
  ],
});

describe("climateGroupOf", () => {
  it("reads clue-head labels and zero-shot climates as Köppen groups", () => {
    expect(climateGroupOf("Arid climate")).toBe("Arid");
    expect(climateGroupOf("Desert")).toBe("Arid");
    expect(climateGroupOf("Mediterranean")).toBe("Temperate");
    expect(climateGroupOf("Snow and ice")).toBe("Continental");
    expect(climateGroupOf("Sunny climate")).toBeNull();
    expect(climateGroupOf("City")).toBeNull();
  });
});

describe("trueClues", () => {
  it("has nothing to show without map labels", () => {
    expect(trueClues(undefined, atlas([]))).toEqual([]);
    expect(trueClues({}, atlas([]))).toEqual([]);
  });

  it("judges the driving side by the country Atlas picked when it read no side", () => {
    const [left] = trueClues({ drivingSide: "left" }, atlas([], "JP"));
    expect(left).toEqual({
      kind: "driving_side",
      truth: "Drives on the left",
      atlas: "drives on the left (its pick, Japan)",
      right: true,
    });
    const [wrong] = trueClues({ drivingSide: "left" }, atlas([]));
    expect(wrong.atlas).toBe("drives on the right (its pick, France)");
    expect(wrong.right).toBe(false);
  });

  it("prefers the driving side Atlas read over its pick's", () => {
    const [clue] = trueClues({ drivingSide: "left" }, atlas(["Drives on the left"]));
    expect(clue.atlas).toBe("drives on the left");
    expect(clue.right).toBe(true);
  });

  it("marks Atlas's climate right or wrong, and says nothing without a climate clue", () => {
    const right = trueClues({ climateGroup: "Temperate" }, atlas(["Village", "Temperate climate"]));
    expect(right[0]).toMatchObject({
      truth: "Temperate climate",
      atlas: "temperate climate",
      right: true,
    });
    const wrong = trueClues({ climateGroup: "Arid" }, atlas(["Mediterranean"]));
    expect(wrong[0]).toMatchObject({ atlas: "temperate climate", right: false });
    const silent = trueClues({ climateGroup: "Arid" }, atlas(["Coast"]));
    expect(silent[0]).toMatchObject({ atlas: null, right: null });
  });

  it("judges land cover only where Atlas's scene clue and the map settle 'built up'", () => {
    const land = (cover: string, labels: string[]) =>
      trueClues({ landCover: cover }, atlas(labels))[0];
    expect(land("Built-up", ["City"])).toMatchObject({
      truth: "Mostly buildings around it",
      atlas: "city",
      right: true,
    });
    expect(land("Built-up", ["No buildings"])).toMatchObject({ right: false });
    expect(land("Tree cover", ["No buildings"])).toMatchObject({
      truth: "Mostly trees around it",
      right: true,
    });
    expect(land("Grassland", ["European old town"])).toMatchObject({ right: false });
    // A harbour or a village says nothing either way.
    expect(land("Permanent water bodies", ["City"])).toMatchObject({
      truth: "Mostly water around it",
      atlas: null,
      right: null,
    });
    expect(land("Built-up", ["Village", "Countryside"])).toMatchObject({
      atlas: null,
      right: null,
    });
  });

  it("shows the truth alone when Atlas sat the photo out", () => {
    const clues = trueClues(
      { drivingSide: "right", climateGroup: "Polar", landCover: "Snow and ice" },
      null,
    );
    expect(clues.map((c) => c.truth)).toEqual([
      "Drives on the right",
      "Polar climate",
      "Mostly snow and ice around it",
    ]);
    expect(clues.every((c) => c.atlas === null && c.right === null)).toBe(true);
  });

  it("leaves out labels it does not know", () => {
    expect(trueClues({ climateGroup: "Sunny", landCover: "Lava" }, null)).toEqual([]);
  });

  it("names every land cover the catalog ships", () => {
    for (const p of photos as { landCover?: string }[]) {
      if (p.landCover) expect(trueClues({ landCover: p.landCover }, null)).toHaveLength(1);
    }
  });
});
