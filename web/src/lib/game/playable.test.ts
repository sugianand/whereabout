import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";

import { pickDaily } from "./daily";
import { pickFresh } from "./fresh";
import { playablePhotos } from "./playable";
import type { AtlasData, AtlasGuess } from "./types";

const guess = { lat: 0, lng: 0 } as AtlasGuess;

describe("playablePhotos", () => {
  it("deals only photos Atlas has guessed, in catalog order", () => {
    const photos = [{ id: "wm000" }, { id: "wh1" }, { id: "wm001" }];
    const atlas = { guesses: { wm001: guess, wm000: guess } };
    expect(playablePhotos(photos, atlas).map((p) => p.id)).toEqual(["wm000", "wm001"]);
  });

  it("deals the whole catalog when Atlas has guessed nothing yet", () => {
    const photos = [{ id: "a" }, { id: "b" }];
    expect(playablePhotos(photos, { guesses: {} })).toEqual(photos);
  });

  it("ignores inherited keys", () => {
    expect(playablePhotos([{ id: "toString" }, { id: "a" }], { guesses: { a: guess } })).toEqual([
      { id: "a" },
    ]);
  });

  it("never deals a photo without Atlas from the bundled data, in either mode", () => {
    const atlas = atlasData as AtlasData;
    const playable = playablePhotos(catalog, atlas);
    expect(playable.length).toBeGreaterThanOrEqual(5);
    if (Object.keys(atlas.guesses).length === 0) return;
    for (let day = 1; day <= 28; day++) {
      const key = `2026-11-${String(day).padStart(2, "0")}`;
      for (const p of pickDaily(playable, key)) expect(atlas.guesses[p.id], key).toBeDefined();
    }
    for (let i = 0; i < 50; i++) {
      for (const p of pickFresh(playable, [])) expect(atlas.guesses[p.id]).toBeDefined();
    }
  });
});
