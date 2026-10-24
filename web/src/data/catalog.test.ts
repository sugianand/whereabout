// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCatalog,
  joinLabels,
  joinQuality,
  parseCsv,
  parseQuality,
} from "../../scripts/build-catalog.mjs";
import photos from "./photos.json";

const csv = readFileSync(resolve(process.cwd(), "../data/curation/photos.csv"), "utf8");
const qualityFile = resolve(process.cwd(), "../data/curation/quality.csv");
const quality = existsSync(qualityFile) ? readFileSync(qualityFile, "utf8") : null;
const labelsFile = resolve(process.cwd(), "../data/labels/concept_labels.csv");
const labels = existsSync(labelsFile) ? readFileSync(labelsFile, "utf8") : null;

describe("bundled catalog", () => {
  it("is in sync with data/curation/photos.csv (run `npm run catalog` if this fails)", () => {
    expect(photos).toEqual(buildCatalog(csv, quality, labels));
  });

  it("has a valid location, image and credit for every photo", () => {
    for (const p of photos) {
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lng).toBeLessThanOrEqual(180);
      expect(p.imageUrl).toMatch(/^https:\/\//);
      expect(p.credit.author).not.toBe("");
      expect(p.credit.license).not.toBe("");
      expect(p.credit.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("joins original sizes from quality.csv by id and omits them otherwise", () => {
    const base = [{ id: "a" }, { id: "b" }];
    const q = "id,width,height,sharpness,sharpness_global\na,4000,3000,1,2\n";
    expect(joinQuality(base, q)).toEqual([{ id: "a", width: 4000, height: 3000 }, { id: "b" }]);
    expect(joinQuality(base, null)).toEqual(base);
    expect(parseQuality(q).get("a")).toEqual({ width: 4000, height: 3000 });
  });

  it("joins hint labels by id and leaves out empty or unknown cells", () => {
    const base = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const l =
      "id,climate,climate_group,land_cover,driving_side\n" +
      "a,Cfb,Temperate,Built-up,left\n" +
      "b,,,,right\n" +
      "c,X,Sunny,,middle\n";
    expect(joinLabels(base, l)).toEqual([
      { id: "a", drivingSide: "left", climateGroup: "Temperate" },
      { id: "b", drivingSide: "right" },
      { id: "c" },
    ]);
    expect(joinLabels(base, null)).toEqual(base);
  });

  it("parses quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});
