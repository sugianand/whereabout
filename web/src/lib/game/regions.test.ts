import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { CONTINENTS, continentOf } from "@/lib/continents";

import { buildDeck, gameRecords, type GameRecord } from "./deck";
import {
  MIN_PER_REGION,
  buildRegions,
  offeredRegions,
  regionBlurb,
  regionFromSlug,
  regionSlug,
  streakRegions,
} from "./regions";
import type { AtlasData, CatalogPhoto } from "./types";

const records = gameRecords(catalog as CatalogPhoto[], atlasData as AtlasData);

function record(id: string, country: string): GameRecord {
  return {
    photo: { id, country, lat: 0, lng: 0 } as unknown as CatalogPhoto,
    atlas: null,
  };
}

describe("continent games", () => {
  it("groups photos by their country's continent, in catalog order", () => {
    const toy = [
      ...["FR", "DE", "IT", "ES", "GB"].map((c, i) => record(`eu${i}`, c)),
      ...["PE", "BR", "CL", "AR", "CO", "EC"].map((c, i) => record(`sa${i}`, c)),
      record("jp0", "JP"),
      record("zz0", "ZZ"),
    ];
    const regions = buildRegions(toy);
    expect(regions.Europe).toEqual(["eu0", "eu1", "eu2", "eu3", "eu4"]);
    expect(regions["South America"]).toHaveLength(6);
    // Too few to fill a game: Asia is not offered. An unknown country joins no continent.
    expect(regions.Asia).toBeUndefined();
    expect(offeredRegions(regions)).toEqual(["Europe", "South America"]);
  });

  it("offers every continent of the real catalog that can fill a game, and only those", () => {
    const deck = buildDeck(records);
    const offered = offeredRegions(deck.regions);
    expect(offered.length).toBeGreaterThan(0);
    for (const c of CONTINENTS) {
      const ids = records.filter((r) => continentOf(r.photo.country) === c).map((r) => r.photo.id);
      if (ids.length >= MIN_PER_REGION) expect(deck.regions[c]).toEqual(ids);
      else expect(deck.regions[c]).toBeUndefined();
    }
    // Every photo dealt from a continent really was taken there.
    const byId = new Map(records.map((r) => [r.photo.id, r]));
    for (const c of offered) {
      for (const id of deck.regions[c]!) expect(continentOf(byId.get(id)!.photo.country)).toBe(c);
    }
  });

  it("names continents in the URL by a slug and reads them back", () => {
    for (const c of CONTINENTS) expect(regionFromSlug(regionSlug(c))).toBe(c);
    expect(regionSlug("South America")).toBe("south-america");
    expect(regionFromSlug("atlantis")).toBeNull();
    expect(regionFromSlug("Europe")).toBeNull();
    expect(regionFromSlug(null)).toBeNull();
  });

  it("says where a continent game's photos come from, with the real count", () => {
    const regions = buildRegions(["FR", "DE", "IT", "ES", "GB"].map((c, i) => record(`eu${i}`, c)));
    expect(regionBlurb("Europe", regions)).toBe("All taken in Europe: 5 photos");
  });
});

describe("Country Streak by continent", () => {
  it("keeps each continent's tappable photos, and only continents with a game's worth", () => {
    const regions = {
      Europe: ["eu0", "eu1", "eu2", "eu3", "eu4", "eu5"],
      Asia: ["as0", "as1", "as2", "as3", "as4"],
    };
    // One European photo is in a country the globe doesn't draw; Asia then has too few left.
    const tappable = ["eu0", "eu2", "eu3", "eu4", "eu5", "as0", "as1", "as2", "as3", "zz0"];
    expect(streakRegions(regions, tappable)).toEqual({
      Europe: ["eu0", "eu2", "eu3", "eu4", "eu5"],
    });
  });

  it("deals every continent of the real catalog only photos the globe can name", () => {
    const deck = buildDeck(records);
    const regions = streakRegions(deck.regions, deck.streakIds);
    const tappable = new Set(deck.streakIds);
    expect(offeredRegions(regions).length).toBeGreaterThan(0);
    for (const c of offeredRegions(regions)) {
      expect(regions[c]!.length).toBeGreaterThanOrEqual(MIN_PER_REGION);
      for (const id of regions[c]!) {
        expect(tappable.has(id)).toBe(true);
        expect(deck.regions[c]).toContain(id);
      }
    }
  });
});
