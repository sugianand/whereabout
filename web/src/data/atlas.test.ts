import { describe, expect, it } from "vitest";

import type { AtlasData } from "@/lib/game/types";

import atlasData from "./atlas.json";
import photos from "./photos.json";

const atlas = atlasData as AtlasData;

// atlas.json is written by .github/workflows/atlas.yml. These checks keep a malformed or
// stale file from reaching players.
describe("Atlas's precomputed guesses", () => {
  it("are labelled with the model that made them, if there are any", () => {
    if (Object.keys(atlas.guesses).length === 0) return;
    expect(atlas.model).toBeTruthy();
    expect(atlas.version).toBeTruthy();
    expect(Date.parse(atlas.generatedAt ?? "")).not.toBeNaN();
  });

  it("only cover photos that are in the catalog", () => {
    const ids = new Set(photos.map((p) => p.id));
    for (const id of Object.keys(atlas.guesses)) expect(ids.has(id)).toBe(true);
  });

  it("have valid coordinates and probabilities", () => {
    for (const g of Object.values(atlas.guesses)) {
      expect(Math.abs(g.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(g.lng)).toBeLessThanOrEqual(180);
      expect(g.confidence).toBeGreaterThanOrEqual(0);
      expect(g.confidence).toBeLessThanOrEqual(1);
      for (const c of g.clues) expect(c.p).toBeGreaterThan(0);
    }
  });
});
