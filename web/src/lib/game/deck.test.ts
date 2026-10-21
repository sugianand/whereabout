import { describe, expect, it, vi } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";

import { pickDaily } from "./daily";
import { LOAD_ERROR, buildDeck, deckVersion, fetchRecords, gameRecords, recordUrl } from "./deck";
import { playablePhotos } from "./playable";
import type { AtlasData, CatalogPhoto } from "./types";

const photos = catalog as CatalogPhoto[];
const atlas = atlasData as AtlasData;
const records = gameRecords(photos, atlas);
const deck = buildDeck(records);

function serve(byUrl: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string | URL | Request) => {
    const body = byUrl[String(url)];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : Response.json(body, { status });
  }) as unknown as typeof fetch;
}

describe("game records", () => {
  it("pair each playable photo with Atlas's guess, in catalog order", () => {
    const playable = playablePhotos(photos, atlas);
    expect(records.map((r) => r.photo)).toEqual(playable);
    for (const r of records) expect(r.atlas).toEqual(atlas.guesses[r.photo.id] ?? null);
  });

  it("keep the Daily Five the same as dealing from the whole catalog", () => {
    const fromIds = pickDaily(deck.ids, "2026-10-21", 5);
    const fromPhotos = pickDaily(playablePhotos(photos, atlas), "2026-10-21", 5).map((p) => p.id);
    expect(fromIds).toEqual(fromPhotos);
  });

  it("get a new version whenever any record changes", () => {
    const moved = records.map((r, i) =>
      i === 0 ? { ...r, photo: { ...r.photo, lat: r.photo.lat + 0.001 } } : r,
    );
    expect(deckVersion(records)).toMatch(/^[0-9a-f]{8}$/);
    expect(deckVersion(records)).toBe(deckVersion(gameRecords(photos, atlas)));
    expect(deckVersion(moved)).not.toBe(deckVersion(records));
  });
});

describe("recordUrl", () => {
  it("serves records under the site's base path and the deck version", () => {
    expect(recordUrl("1a2b3c4d", "wm000", "/whereabout")).toBe(
      "/whereabout/game-data/1a2b3c4d/wm000.json",
    );
    expect(recordUrl("1a2b3c4d", "wm000", "")).toBe("/game-data/1a2b3c4d/wm000.json");
  });
});

describe("fetchRecords", () => {
  const ids = deck.ids.slice(0, 5);
  const files = Object.fromEntries(
    records.map((r) => [recordUrl(deck.version, r.photo.id), JSON.parse(JSON.stringify(r))]),
  );

  it("fetches exactly the records asked for, in order", async () => {
    const fetchImpl = serve(files);
    const got = await fetchRecords(deck, [...ids].reverse(), fetchImpl);
    expect(got.map((r) => r.photo.id)).toEqual([...ids].reverse());
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("fails with a message for players on a missing file, a network error or a wrong body", async () => {
    await expect(fetchRecords(deck, ["nope"], serve(files))).rejects.toThrow(LOAD_ERROR);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchRecords(deck, ids, offline)).rejects.toThrow(LOAD_ERROR);
    const swapped = { [recordUrl(deck.version, ids[0])]: files[recordUrl(deck.version, ids[1])] };
    await expect(fetchRecords(deck, [ids[0]], serve(swapped))).rejects.toThrow(LOAD_ERROR);
  });
});
