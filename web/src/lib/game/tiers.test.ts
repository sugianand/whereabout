import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { haversineKm } from "@/lib/geo";

import { buildDeck, gameRecords, type GameRecord } from "./deck";
import { pickFresh } from "./fresh";
import { ROUNDS_PER_GAME } from "./state";
import { TIERS, atlasErrorKm, buildTiers, isTier, tierBlurb } from "./tiers";
import type { AtlasData, AtlasGuess, CatalogPhoto } from "./types";

const records = gameRecords(catalog as CatalogPhoto[], atlasData as AtlasData);
const byId = new Map(records.map((r) => [r.photo.id, r]));

/** A photo at (0, lat) that Atlas guessed at (0, 0): Atlas's error grows with `lat`. */
function record(id: string, lat: number | null): GameRecord {
  const photo = { id, lat: lat ?? 0, lng: 0, imageUrl: `https://x/${id}.jpg` } as CatalogPhoto;
  const atlas = lat === null ? null : ({ lat: 0, lng: 0, confidence: 0.5 } as AtlasGuess);
  return { photo, atlas };
}

describe("atlasErrorKm", () => {
  it("is the distance from Atlas's guess to the photo, or null when Atlas sat it out", () => {
    expect(atlasErrorKm(record("a", 10))).toBeCloseTo(
      haversineKm({ lng: 0, lat: 0 }, { lng: 0, lat: 10 }),
    );
    expect(atlasErrorKm(record("b", null))).toBeNull();
  });
});

describe("buildTiers on synthetic data", () => {
  it("cuts the photos into thirds from Atlas's smallest miss to its largest", () => {
    const rs = Array.from({ length: 15 }, (_, i) =>
      record(`p${String(i).padStart(2, "0")}`, 14 - i),
    );
    const tiers = buildTiers(rs)!;
    expect(tiers.easy.ids).toEqual(["p14", "p13", "p12", "p11", "p10"]);
    expect(tiers.medium.ids).toEqual(["p09", "p08", "p07", "p06", "p05"]);
    expect(tiers.hard.ids).toEqual(["p04", "p03", "p02", "p01", "p00"]);
    expect(tiers.easy.maxKm).toBeLessThan(tiers.medium.minKm);
    expect(tiers.medium.maxKm).toBeLessThan(tiers.hard.minKm);
  });

  it("leaves out photos Atlas sat out, and breaks ties by id", () => {
    const rs = [
      ...Array.from({ length: 15 }, (_, i) => record(`t${i}`, 5)),
      record("skipped", null),
    ];
    const tiers = buildTiers(rs)!;
    const all = TIERS.flatMap((t) => tiers[t].ids);
    expect(all).not.toContain("skipped");
    expect(all).toEqual([...all].sort());
    expect(buildTiers([...rs].reverse())).toEqual(tiers);
  });

  it("gives no tiers when some tier could not fill a game", () => {
    expect(buildTiers(Array.from({ length: 14 }, (_, i) => record(`p${i}`, i)))).toBeNull();
    expect(buildTiers(Array.from({ length: 30 }, (_, i) => record(`p${i}`, null)))).toBeNull();
  });
});

describe("tiers from the real Atlas guesses", () => {
  const tiers = buildTiers(records)!;

  it("exist for the shipped catalog and every tier can deal a whole game", () => {
    expect(tiers).not.toBeNull();
    for (const tier of TIERS) {
      expect(tiers[tier].ids.length).toBeGreaterThanOrEqual(ROUNDS_PER_GAME);
      const game = pickFresh(
        tiers[tier].ids.map((id) => ({ id })),
        [],
        ROUNDS_PER_GAME,
      );
      expect(new Set(game.map((p) => p.id)).size).toBe(ROUNDS_PER_GAME);
    }
  });

  it("cover every photo Atlas guessed exactly once, in near-equal thirds", () => {
    const guessed = records.filter((r) => r.atlas).map((r) => r.photo.id);
    const all = TIERS.flatMap((t) => tiers[t].ids);
    expect([...all].sort()).toEqual([...guessed].sort());
    const sizes = TIERS.map((t) => tiers[t].ids.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("come from Atlas's measured errors: every Easy photo was missed by less than any Hard one", () => {
    const err = (id: string) => atlasErrorKm(byId.get(id)!)!;
    for (const tier of TIERS) {
      const errors = tiers[tier].ids.map(err);
      expect(errors).toEqual([...errors].sort((a, b) => a - b));
      expect(tiers[tier].minKm).toBe(errors[0]);
      expect(tiers[tier].maxKm).toBe(errors.at(-1));
    }
    expect(tiers.easy.maxKm).toBeLessThanOrEqual(tiers.medium.minKm);
    expect(tiers.medium.maxKm).toBeLessThanOrEqual(tiers.hard.minKm);
  });

  it("ride along in the deck the home page ships", () => {
    expect(buildDeck(records).tiers).toEqual(tiers);
  });
});

describe("tierBlurb", () => {
  const rs = [
    ...Array.from({ length: 5 }, (_, i) => record(`e${i}`, 1 + i * 0.1)),
    ...Array.from({ length: 5 }, (_, i) => record(`m${i}`, 3.24 + i)),
    ...Array.from({ length: 5 }, (_, i) => record(`h${i}`, 21.06 + i)),
  ];
  const tiers = buildTiers(rs)!;
  const km = (lat: number) => haversineKm({ lng: 0, lat: 0 }, { lng: 0, lat });

  it("states each tier's real cut points, rounded for reading", () => {
    // Medium starts at about 360 km and Hard at about 2,342 km from Atlas's guess.
    expect(km(3.24)).toBeCloseTo(360.3, 0);
    expect(km(21.06)).toBeCloseTo(2341.8, 0);
    expect(tierBlurb("easy", tiers)).toBe("Atlas missed these by under 360 km");
    expect(tierBlurb("medium", tiers)).toBe("Atlas missed these by 360 km to 2,300 km");
    expect(tierBlurb("hard", tiers)).toBe("Atlas missed these by 2,300 km or more");
  });
});

describe("isTier", () => {
  it("accepts only the three tier names", () => {
    expect(TIERS.every(isTier)).toBe(true);
    for (const v of ["", "Hard", "extreme", null, 2]) expect(isTier(v)).toBe(false);
  });
});
