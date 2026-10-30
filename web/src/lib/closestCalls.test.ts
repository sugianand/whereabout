import { describe, expect, it } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { haversineKm } from "@/lib/geo";
import type { PlayedPhoto } from "@/lib/playedMap";

import { CLOSEST_CALLS, atlasKm, closestCalls, continentGameHref, verdict } from "./closestCalls";

function played(id: string, km: number | null, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: `Place ${id}`,
    country: "FR",
    km,
    score: km === null ? 0 : 4000,
    day: "2026-10-30",
    ...over,
  };
}

function record(id: string, atlas: { lng: number; lat: number } | null): GameRecord {
  return {
    photo: {
      id,
      imageUrl: "https://upload.wikimedia.org/x.jpg",
      lng: 2.35,
      lat: 48.86,
      place: `Place ${id}`,
      country: "FR",
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://commons.wikimedia.org/" },
    },
    atlas: atlas && { ...atlas, confidence: 0.5, topCountries: [], clues: [] },
  };
}

describe("closestCalls", () => {
  it("picks the five nearest pins, nearest first", () => {
    const history = [900, 3, 40, 12_000, 0.4, 250, 7].map((km, i) => played(`p${i}`, km));
    const calls = closestCalls(history);
    expect(calls).toHaveLength(CLOSEST_CALLS);
    expect(calls.map((c) => c.km)).toEqual([0.4, 3, 7, 40, 250]);
  });

  it("never counts a round with no pin", () => {
    const calls = closestCalls([played("a", null), played("b", 5000), played("c", null)]);
    expect(calls.map((c) => c.id)).toEqual(["b"]);
    expect(closestCalls([played("a", null)])).toEqual([]);
    expect(closestCalls([])).toEqual([]);
  });

  it("breaks a tie on distance by score, then by the newer round", () => {
    const calls = closestCalls([
      played("old", 10, { score: 4000 }),
      played("hinted", 10, { score: 2500 }),
      played("new", 10, { score: 4000 }),
    ]);
    expect(calls.map((c) => c.id)).toEqual(["new", "old", "hinted"]);
  });

  it("leaves the history it was given alone", () => {
    const history = [played("a", 30), played("b", 3)];
    closestCalls(history);
    expect(history.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("returns fewer when asked for fewer", () => {
    const history = [played("a", 30), played("b", 3)];
    expect(closestCalls(history, 1).map((c) => c.id)).toEqual(["b"]);
    expect(closestCalls(history, 0)).toEqual([]);
  });
});

describe("atlasKm", () => {
  it("measures Atlas's pin to the answer kept with the round", () => {
    const call = played("a", 2);
    const pin = { lng: 13.4, lat: 52.52 };
    expect(atlasKm(call, record("a", pin))).toBeCloseTo(haversineKm(pin, call), 6);
    expect(atlasKm(call, record("a", { lng: call.lng, lat: call.lat }))).toBe(0);
  });

  it("is null without a record, when Atlas sat out, or for another photo's record", () => {
    const call = played("a", 2);
    expect(atlasKm(call, null)).toBeNull();
    expect(atlasKm(call, undefined)).toBeNull();
    expect(atlasKm(call, record("a", null))).toBeNull();
    expect(atlasKm(call, record("b", { lng: 0, lat: 0 }))).toBeNull();
  });
});

describe("verdict", () => {
  it("says who got closer, calling the same tenth of a kilometre a tie", () => {
    expect(verdict(3, 800)).toBe("you");
    expect(verdict(800, 3)).toBe("atlas");
    expect(verdict(12.31, 12.34)).toBe("tie");
    expect(verdict(12.2, 12.4)).toBe("you");
  });
});

describe("continentGameHref", () => {
  const regions = { Europe: ["a", "b", "c", "d", "e"], "South America": ["f", "g", "h", "i", "j"] };

  it("links to the continent game of the photo's country", () => {
    expect(continentGameHref(played("a", 1, { country: "FR" }), regions)).toBe("/?region=europe");
    expect(continentGameHref(played("a", 1, { country: "BR" }), regions)).toBe(
      "/?region=south-america",
    );
  });

  it("offers nothing for a continent that can't fill a game or a photo with no country", () => {
    expect(continentGameHref(played("a", 1, { country: "JP" }), regions)).toBeNull();
    expect(continentGameHref(played("a", 1, { country: null }), regions)).toBeNull();
    expect(continentGameHref(played("a", 1, { country: "FR" }), { Europe: [] })).toBeNull();
  });
});
