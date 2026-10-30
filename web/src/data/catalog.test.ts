// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCatalog,
  joinLabels,
  joinPostcards,
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
const postcardsFile = resolve(process.cwd(), "../data/postcards/postcards.csv");
const postcards = existsSync(postcardsFile) ? readFileSync(postcardsFile, "utf8") : null;

describe("bundled catalog", () => {
  it("is in sync with data/curation/photos.csv (run `npm run catalog` if this fails)", () => {
    expect(photos).toEqual(buildCatalog(csv, quality, labels, postcards));
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

  it("credits each photo to its own source page, so the reveal's credit link names one photo", () => {
    const sources = photos.map((p) => p.credit.sourceUrl);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("joins original sizes from quality.csv by id and omits them otherwise", () => {
    const base = [{ id: "a" }, { id: "b" }];
    const q = "id,width,height,sharpness,sharpness_global\na,4000,3000,1,2\n";
    expect(joinQuality(base, q)).toEqual([{ id: "a", width: 4000, height: 3000 }, { id: "b" }]);
    expect(joinQuality(base, null)).toEqual(base);
    expect(parseQuality(q).get("a")).toEqual({ width: 4000, height: 3000 });
  });

  it("joins concept labels by id and leaves out empty or unknown cells", () => {
    const base = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const l =
      "id,climate,climate_group,land_cover,driving_side\n" +
      "a,Cfb,Temperate,Built-up,left\n" +
      "b,,,,right\n" +
      "c,X,Sunny,Lava,middle\n";
    expect(joinLabels(base, l)).toEqual([
      { id: "a", drivingSide: "left", climateGroup: "Temperate", landCover: "Built-up" },
      { id: "b", drivingSide: "right" },
      { id: "c" },
    ]);
    expect(joinLabels(base, null)).toEqual(base);
  });

  it("gives postcards only to catalog photos, each one at most once", () => {
    expect(postcards, "data/postcards/postcards.csv is committed").not.toBeNull();
    const ids = parseCsv(postcards!)
      .slice(1)
      .map((cells) => cells[0]);
    const catalogIds = new Set(photos.map((p) => p.id));
    expect(ids.filter((id) => !catalogIds.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries every postcard the workflow found into the catalog, links checked", () => {
    const withPostcard = photos.filter((p) => "postcard" in p);
    expect(withPostcard.length).toBeGreaterThan(0);
    for (const p of withPostcard) {
      const card = (p as { postcard: { description?: string; article?: { url: string } } })
        .postcard;
      expect(card.description ?? card.article, p.id).toBeTruthy();
      if (card.article) expect(card.article.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
    }
  });

  it("joins postcards by id and leaves out empty, overlong or off-Wikipedia parts", () => {
    const base = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const w = "https://en.wikipedia.org/wiki/";
    const text =
      "id,description,wikipedia_title,wikipedia_url,link_via\n" +
      `a,"Peaks, at sunrise.",Vang Vieng,${w}Vang_Vieng,depicts\n` +
      `b,,Kourou,${w}Kourou,place\n` +
      `c,${"x".repeat(241)},Evil,javascript:alert(1),place\n` +
      "d,A pier at dusk.,,,\n" +
      `e,  ,,${w}Untitled,place\n`;
    expect(joinPostcards(base, text)).toEqual([
      {
        id: "a",
        postcard: {
          description: "Peaks, at sunrise.",
          article: { title: "Vang Vieng", url: `${w}Vang_Vieng` },
        },
      },
      { id: "b", postcard: { article: { title: "Kourou", url: `${w}Kourou` } } },
      { id: "c" },
      { id: "d", postcard: { description: "A pier at dusk." } },
      { id: "e" },
    ]);
    expect(joinPostcards(base, null)).toEqual(base);
  });

  it("parses quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});
