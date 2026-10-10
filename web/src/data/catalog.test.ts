// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCsv, toCatalog } from "../../scripts/build-catalog.mjs";
import photos from "./photos.json";

const csv = readFileSync(resolve(process.cwd(), "../data/curation/photos.csv"), "utf8");

describe("bundled catalog", () => {
  it("is in sync with data/curation/photos.csv (run `npm run catalog` if this fails)", () => {
    expect(photos).toEqual(toCatalog(csv));
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

  it("parses quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});
