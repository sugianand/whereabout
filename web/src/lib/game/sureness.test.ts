import { describe, expect, it } from "vitest";

import { bundledRecords } from "./bundled";
import { buildDeck, type GameRecord } from "./deck";
import {
  MIN_BAND_PHOTOS,
  SURENESS_EDGES,
  bandFor,
  bandLabel,
  surenessBands,
  surenessLine,
} from "./sureness";

function rec(id: string, country: string, top: string | null, confidence: number): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://x/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country,
      credit: { author: "A", license: "CC0", sourceUrl: "https://x" },
    },
    atlas:
      top === null
        ? null
        : {
            lng: 0,
            lat: 0,
            confidence,
            topCountries: [{ country: top, p: confidence }],
            clues: [],
          },
  };
}

describe("surenessBands", () => {
  it("counts each photo in the band of Atlas's confidence, and whether its top country was right", () => {
    const bands = surenessBands([
      rec("a", "JP", "JP", 0.1),
      rec("b", "JP", "CN", 0.15),
      rec("c", "PE", "PE", 0.2), // a band's lower edge belongs to it
      rec("d", "FR", "FR", 0.8),
      rec("e", "FR", "FR", 1), // certainty lands in the top band, not a sixth one
      rec("f", "IT", null, 0.9), // Atlas never guessed it
      rec("g", "", "IT", 0.9), // no true country to check against
    ]);
    expect(bands.map((b) => [b.lo, b.hi, b.n, b.right])).toEqual([
      [0, 0.2, 2, 1],
      [0.2, 0.4, 1, 1],
      [0.4, 0.6, 0, 0],
      [0.6, 0.8, 0, 0],
      [0.8, 1, 2, 2],
    ]);
  });

  it("covers every photo the game deals with a known country, and matches their real hits", () => {
    const bands = buildDeck(bundledRecords).sureness;
    expect(bands).toHaveLength(SURENESS_EDGES.length - 1);
    const judged = bundledRecords.filter((r) => r.atlas?.topCountries?.length && r.photo.country);
    expect(bands.reduce((s, b) => s + b.n, 0)).toBe(judged.length);
    const right = judged.filter((r) => r.atlas!.topCountries[0].country === r.photo.country);
    expect(bands.reduce((s, b) => s + b.right, 0)).toBe(right.length);
  });
});

describe("surenessLine", () => {
  const many = Array.from({ length: MIN_BAND_PHOTOS }, (_, i) =>
    rec(`p${i}`, "JP", i < 7 ? "JP" : "KR", 0.65),
  );

  it("quotes the band's real counts", () => {
    const bands = surenessBands(many);
    expect(surenessLine(bands, 0.7)).toBe(
      `When Atlas is 60–80% sure, it names the right country in 7 of ${MIN_BAND_PHOTOS} photos.`,
    );
    expect(bandLabel(bandFor(bands, 0.6)!)).toBe("60–80%");
  });

  it("says nothing for a thin band or a confidence that is not a number", () => {
    const bands = surenessBands(many.slice(1));
    expect(surenessLine(bands, 0.7)).toBeNull();
    expect(surenessLine(surenessBands(many), Number.NaN)).toBeNull();
    expect(surenessLine([], 0.7)).toBeNull();
  });

  it("reads bands counted elsewhere only if they sit on the same edges", () => {
    // Pocket Atlas's bands come from Python (`sureness_bands` in calibration.py).
    const bands = surenessBands(many);
    expect(
      surenessLine(
        bands.map((b) => ({ ...b })),
        0.7,
      ),
    ).not.toBeNull();
    const shifted = bands.map((b, i) => (i === 3 ? { ...b, lo: 0.5 } : b));
    expect(surenessLine(shifted, 0.7)).toBeNull();
  });
});
