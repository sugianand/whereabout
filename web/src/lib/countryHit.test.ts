import { describe, expect, it } from "vitest";

import catalog from "@/data/photos.json";

import { alpha2ForNumeric, countryAt, tappableCountries, unwrapRing } from "./countryHit";
import { ALPHA2_TO_NUMERIC } from "./countryIds";

describe("countryAt", () => {
  it.each([
    ["FR", 2.35, 48.86], // Paris
    ["JP", 139.69, 35.69], // Tokyo
    ["BR", -47.88, -15.79], // Brasília
    ["US", -150, 64], // Alaska
    ["AU", 146.8, -42], // Tasmania
    ["SE", 16.6, 67.3], // Padjelanta, near the Norwegian border
    ["ZA", 28.05, -26.2], // Johannesburg
  ])("finds %s at (%f, %f)", (code, lng, lat) => {
    expect(countryAt({ lng, lat })).toBe(code);
  });

  it("puts a point in Lesotho in Lesotho, not in the South Africa around it", () => {
    expect(countryAt({ lng: 27.48, lat: -29.31 })).toBe("LS"); // Maseru
  });

  it("handles countries cut by the antimeridian on both sides of it", () => {
    expect(countryAt({ lng: 177.5, lat: 64.7 })).toBe("RU"); // Anadyr
    expect(countryAt({ lng: -175, lat: 66 })).toBe("RU"); // Chukotka, east of 180°
    expect(countryAt({ lng: 178.4, lat: -17.8 })).toBe("FJ");
    expect(countryAt({ lng: -179.9, lat: -16.3 })).toBe("FJ");
    // The same place a whole turn round the globe, as a spun map can report it.
    expect(countryAt({ lng: 177.5 - 360, lat: 64.7 })).toBe("RU");
  });

  it("does not let a seam-crossing ring swallow the rest of the world", () => {
    // Before unwrapping, mainland Russia's ring ran from -180° to 180° and caught Sweden.
    expect(countryAt({ lng: 16.6, lat: 67.3 })).not.toBe("RU");
    expect(countryAt({ lng: 10, lat: 50 })).toBe("DE");
  });

  it("closes Antarctica along the pole", () => {
    expect(countryAt({ lng: 0, lat: -89 })).toBe("AQ");
    expect(countryAt({ lng: 135, lat: -80 })).toBe("AQ");
    expect(countryAt({ lng: 0, lat: -55 })).toBeNull();
  });

  it("returns null over the sea", () => {
    expect(countryAt({ lng: -30, lat: 30 })).toBeNull(); // mid-Atlantic
    expect(countryAt({ lng: -150, lat: -20 })).toBeNull(); // South Pacific
  });
});

describe("unwrapRing", () => {
  it("removes the jump at the antimeridian", () => {
    const ring = [
      [179, 0],
      [180, 1],
      [-179, 1],
      [-179, -1],
      [180, -1],
      [179, 0],
    ];
    expect(unwrapRing(ring)).toEqual([
      [179, 0],
      [180, 1],
      [181, 1],
      [181, -1],
      [180, -1],
      [179, 0],
    ]);
  });

  it("leaves an ordinary ring alone", () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(unwrapRing(ring)).toEqual(ring);
  });
});

describe("tappableCountries", () => {
  it("names only countries the 1:110m globe draws", () => {
    const tappable = tappableCountries();
    for (const code of ["FR", "JP", "BR", "LS", "FJ", "AQ"]) expect(tappable.has(code)).toBe(true);
    // Too small for the 110m shapes: a photo there could never be tapped.
    for (const code of ["SG", "MT", "MV", "BB"]) expect(tappable.has(code)).toBe(false);
  });

  it("finds most catalog photos inside their own country on the globe", () => {
    // Coastal and island photos can sit just off the coarse coastline, but a photo should never
    // land inside a different country than its own unless it is right on a border.
    const tappable = tappableCountries();
    const wrong = (catalog as { id: string; lng: number; lat: number; country: string }[])
      .filter((p) => tappable.has(p.country))
      .map((p) => ({ id: p.id, own: p.country, hit: countryAt(p) }))
      .filter((p) => p.hit !== null && p.hit !== p.own);
    // wm122 is Victoria Falls, on the Zambia and Zimbabwe border.
    expect(wrong.map((p) => p.id).filter((id) => id !== "wm122")).toEqual([]);
  });
});

describe("alpha2ForNumeric", () => {
  it("inverts the ISO table", () => {
    expect(alpha2ForNumeric("250")).toBe("FR");
    expect(alpha2ForNumeric("999")).toBeUndefined();
    for (const [alpha2, numeric] of Object.entries(ALPHA2_TO_NUMERIC)) {
      expect(alpha2ForNumeric(numeric)).toBe(alpha2);
    }
  });
});
