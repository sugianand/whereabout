import { describe, expect, it, vi } from "vitest";

import catalog from "@/data/photos.json";
import { buildAlbum } from "@/lib/album";
import { countryName } from "@/lib/countries";
import { bundledContinents } from "@/lib/game/bundled";
import type { CatalogPhoto } from "@/lib/game/types";
import type { PlayedPhoto } from "@/lib/playedMap";

import {
  ALBUM_SHARE_NOTE,
  CLOSEST_SHOWN,
  albumHome,
  albumShareCard,
  albumShareLayout,
  albumShareName,
  albumShareSummary,
  albumShareText,
  sendAlbumShare,
} from "./albumShare";
import { IMAGE_SIZE, INK } from "./shareImage";

const photos = catalog as CatalogPhoto[];
const PAGE = "https://example.org/whereabout/album/?from=map#top";
const KMS = [812.4, 3.2, null, 0.4, 2400, 55];

/** Your map's record of a round on `photo`, `km` off. */
function played(photo: CatalogPhoto, km: number | null): PlayedPhoto {
  return {
    id: photo.id,
    lng: photo.lng,
    lat: photo.lat,
    place: photo.place,
    country: photo.country,
    km,
    score: 1000,
    day: "2026-11-01",
  };
}

const dealt = photos.filter((p) => Object.hasOwn(bundledContinents, p.id));

function albumOf(found: readonly CatalogPhoto[], kms: readonly (number | null)[] = KMS) {
  return buildAlbum(
    bundledContinents,
    found.map((p, i) => played(p, kms[i % kms.length])),
  );
}

const words = (found: readonly CatalogPhoto[]) =>
  albumShareLayout(albumShareCard(albumOf(found), PAGE)).texts.map((t) => t.text);

describe("albumShareCard", () => {
  it("counts the whole album and every page, as the album does", () => {
    const album = albumOf(dealt.slice(0, 6));
    const card = albumShareCard(album, PAGE);
    expect(card.found).toBe(6);
    expect(card.total).toBe(album.total);
    expect(card.pages.map((p) => p.continent)).toEqual(album.continents.map((r) => r.continent));
    expect(card.pages.reduce((n, p) => n + p.found, 0)).toBe(6);
    expect(card.pages.reduce((n, p) => n + p.total, 0)).toBe(album.total);
  });

  it("keeps the closest finds, closest first, never one with no pin", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 6)), PAGE);
    expect(card.closest.map((f) => f.km)).toEqual([0.4, 3.2, 55]);
    expect(card.closest).toHaveLength(CLOSEST_SHOWN);
    for (const f of card.closest) {
      const p = dealt[KMS.indexOf(f.km)];
      expect(f.continent).toBe(bundledContinents[p.id]);
    }
    const noPins = albumShareCard(albumOf(dealt.slice(0, 2), [null]), PAGE);
    expect(noPins.closest).toEqual([]);
  });

  it("points to the game's home page, without the album's path or query", () => {
    expect(albumHome(PAGE)).toBe("https://example.org/whereabout/");
    expect(albumHome("https://example.org/album")).toBe("https://example.org/");
    expect(albumHome("http://localhost:3000/album/")).toBe("http://localhost:3000/");
  });
});

describe("albumShareText", () => {
  it("is counts only: the album, each page, and where to play", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 6)), PAGE);
    const lines = albumShareText(card).split("\n");
    expect(lines[0]).toBe(
      `Whereabout album: 6 of ${card.total.toLocaleString("en-US")} photos found`,
    );
    expect(lines[1]).toBe(
      card.pages
        .map((p) => `${p.continent} ${p.found}/${p.total.toLocaleString("en-US")}`)
        .join(" · "),
    );
    expect(lines[2]).toBe("https://example.org/whereabout/");
    expect(lines).toHaveLength(3);
    expect(albumShareSummary(card)).toMatch(/^Your album: 6 of [\d,]+ photos found\.$/);
  });
});

describe("albumShareLayout", () => {
  it("draws the count, every page with a bar and its count, the closest finds and the address", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 6)), PAGE);
    const layout = albumShareLayout(card);
    const w = layout.texts.map((t) => t.text);
    expect(w).toContain("WHEREABOUT");
    expect(w).toContain("My album");
    expect(w).toContain("6");
    for (const p of card.pages) {
      expect(w).toContain(p.continent);
      expect(w).toContain(`${p.found} / ${p.total.toLocaleString("en-US")}`);
    }
    expect(w).toContain("Closest finds");
    expect(w).toEqual(expect.arrayContaining(["400 m", "3.2 km", "55 km"]));
    expect(w).toContain("example.org/whereabout/");
    // A track for every page, and a fill for each page with a photo found.
    const filled = card.pages.filter((p) => p.found > 0).length;
    expect(layout.rects).toHaveLength(1 + card.pages.length + filled);
    expect(layout.marks).toHaveLength(CLOSEST_SHOWN);
  });

  it("shows the closest finds in the player's units", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 6)), PAGE);
    const w = albumShareLayout(card, "mi").texts.map((t) => t.text);
    expect(w).toEqual(expect.arrayContaining(["0.2 mi", "2.0 mi", "34 mi"]));
  });

  it("fills a page's bar in proportion, and a full page in sonar", () => {
    const album = albumOf(dealt.slice(0, 1));
    const full = album.continents.find((r) => r.found.length > 0)!;
    const card = albumShareCard(album, PAGE);
    const half = albumShareLayout(card).rects;
    const fill = half.find((r) => r.fill === INK.gold)!;
    const track = half.find((r) => r.fill === INK.frame && r.y === fill.y)!;
    expect(track.x).toBe(fill.x);
    expect(fill.w).toBeGreaterThanOrEqual(fill.h);
    expect(fill.w).toBeLessThan(track.w);

    const whole = albumShareCard(
      { ...album, continents: [{ ...full, total: full.found.length }] },
      PAGE,
    );
    const rects = albumShareLayout(whole).rects;
    expect(rects.some((r) => r.fill === INK.sonar && r.w === track.w)).toBe(true);
  });

  it("leaves out the closest finds when no find had a pin", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 2), [null]), PAGE);
    const layout = albumShareLayout(card);
    expect(layout.texts.map((t) => t.text)).not.toContain("Closest finds");
    expect(layout.marks).toEqual([]);
  });

  it("keeps every shape and word inside the frame", () => {
    const layout = albumShareLayout(albumShareCard(albumOf(dealt.slice(0, 40)), PAGE));
    for (const r of layout.rects.slice(1)) {
      expect(r.x).toBeGreaterThanOrEqual(32);
      expect(r.y).toBeGreaterThanOrEqual(32);
      expect(r.x + r.w).toBeLessThanOrEqual(IMAGE_SIZE - 32);
      expect(r.y + r.h).toBeLessThanOrEqual(IMAGE_SIZE - 32);
    }
    for (const t of layout.texts) {
      expect(t.y).toBeGreaterThan(32);
      expect(t.y).toBeLessThan(IMAGE_SIZE - 32);
    }
    // The closest finds sit below the last page.
    const lastPage = Math.max(...layout.rects.slice(1).map((r) => r.y + r.h));
    const heading = layout.texts.find((t) => t.text === "Closest finds")!;
    expect(heading.y - 30).toBeGreaterThan(lastPage);
  });

  it("never draws a place, country, photo id or author, for every photo in the catalog", () => {
    for (let i = 0; i + 6 <= dealt.length; i += 6) {
      const found = dealt.slice(i, i + 6);
      const all = words(found).join("\n");
      for (const p of found) {
        for (const part of [p.place, countryName(p.country), p.id, p.credit.author]) {
          if (part) expect(all).not.toContain(part);
        }
      }
    }
  });
});

describe("sending the album", () => {
  it("names the file after the count", () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 6)), PAGE);
    expect(albumShareName(card)).toBe(`whereabout-album-6-of-${card.total}.png`);
  });

  it("says when the browser can't draw the picture", async () => {
    const card = albumShareCard(albumOf(dealt.slice(0, 2)), PAGE);
    // jsdom has no 2D canvas, so the picture can't be drawn.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const outcome = await sendAlbumShare(card, "km", {} as Navigator);
    expect(outcome).toBe("failed");
    expect(ALBUM_SHARE_NOTE[outcome]).toMatch(/as text/);
    vi.restoreAllMocks();
  });
});
