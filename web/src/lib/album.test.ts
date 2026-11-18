import { describe, expect, it } from "vitest";

import type { Continent } from "@/lib/continents";
import type { PlayedPhoto } from "@/lib/playedMap";

import { SWIPE_PX, buildAlbum, eachLimited, percentFound, stepIn, swipeStep } from "./album";

function played(id: string, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 0,
    lat: 0,
    place: `Place ${id}`,
    country: "FR",
    km: 100,
    score: 4000,
    day: "2026-11-18",
    ...over,
  };
}

const continents: Record<string, Continent> = {
  e1: "Europe",
  e2: "Europe",
  e3: "Europe",
  a1: "Asia",
  o1: "Oceania",
};

describe("buildAlbum", () => {
  it("counts every dealt photo by continent, in the site's continent order", () => {
    const album = buildAlbum(continents, []);
    expect(album.total).toBe(5);
    expect(album.found).toBe(0);
    expect(album.continents.map((c) => [c.continent, c.total, c.found.length])).toEqual([
      ["Asia", 1, 0],
      ["Europe", 3, 0],
      ["Oceania", 1, 0],
    ]);
  });

  it("files each played photo under its continent, newest first", () => {
    const album = buildAlbum(continents, [played("e1"), played("a1"), played("e3")]);
    expect(album.found).toBe(3);
    const europe = album.continents.find((c) => c.continent === "Europe")!;
    expect(europe.found.map((p) => p.id)).toEqual(["e3", "e1"]);
    expect(album.continents.find((c) => c.continent === "Asia")!.found).toHaveLength(1);
  });

  it("leaves out photos the site no longer deals, and never counts a photo twice", () => {
    const album = buildAlbum(continents, [
      played("gone"),
      played("e1"),
      played("e1", { km: 5 }),
      played("constructor"),
    ]);
    expect(album.found).toBe(1);
    expect(album.continents.find((c) => c.continent === "Europe")!.found).toEqual([
      played("e1", { km: 5 }),
    ]);
  });
});

describe("percentFound", () => {
  it("reads 0 for none and 100 only once every photo is found", () => {
    expect(percentFound(0, 388)).toBe(0);
    expect(percentFound(1, 388)).toBe(1);
    expect(percentFound(194, 388)).toBe(50);
    expect(percentFound(387, 388)).toBe(99);
    expect(percentFound(388, 388)).toBe(100);
    expect(percentFound(3, 0)).toBe(0);
  });
});

describe("eachLimited", () => {
  it("runs every item with no more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      running--;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it("stops starting new items once cancelled", async () => {
    const done: number[] = [];
    let cancelled = false;
    await eachLimited(
      [1, 2, 3, 4],
      1,
      async (n) => {
        done.push(n);
        if (n === 2) cancelled = true;
      },
      () => cancelled,
    );
    expect(done).toEqual([1, 2]);
  });
});

describe("stepIn", () => {
  it("turns the page either way and holds at both ends", () => {
    expect(stepIn(5, 2, 1)).toBe(3);
    expect(stepIn(5, 2, -1)).toBe(1);
    expect(stepIn(5, 4, 1)).toBe(4);
    expect(stepIn(5, 0, -1)).toBe(0);
    expect(stepIn(0, 0, 1)).toBe(0);
  });
});

describe("swipeStep", () => {
  it("reads a long sideways swipe left as next and right as previous", () => {
    expect(swipeStep(-SWIPE_PX, 0)).toBe(1);
    expect(swipeStep(SWIPE_PX + 20, 10)).toBe(-1);
  });

  it("ignores a short move, a tap and a scroll", () => {
    expect(swipeStep(-(SWIPE_PX - 1), 0)).toBe(0);
    expect(swipeStep(0, 0)).toBe(0);
    expect(swipeStep(-80, 120)).toBe(0);
  });
});
