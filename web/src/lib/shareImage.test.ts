import { describe, expect, it, vi } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { countryName } from "@/lib/countries";
import type { RoundResult } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto } from "@/lib/game/types";

import { DISTANCE_BANDS, shareCard, type ShareCard } from "./share";
import {
  BAND_COLORS,
  IMAGE_SIZE,
  VERSUS_WORD,
  drawShareImage,
  sendShareImage,
  shareImageLayout,
  shareImageName,
  type DrawingContext,
} from "./shareImage";

const photos = catalog as CatalogPhoto[];
const atlas = atlasData as unknown as AtlasData;
const GAME = "https://example.org/whereabout/?daily";

/** A round with these numbers, taken at `photo` (or nowhere in particular). */
function result(
  km: number | null,
  score: number,
  atlasScore?: number,
  photo?: CatalogPhoto,
  hintsUsed = 0,
): RoundResult {
  const where = photo ?? {
    id: "p",
    imageUrl: "https://example.org/p.jpg",
    lng: 0,
    lat: 0,
    place: "",
    country: "",
    credit: { author: "", license: "", sourceUrl: "" },
  };
  return {
    round: {
      roundId: `r-${where.id}`,
      photo: { id: where.id, imageUrl: where.imageUrl },
      hintsAvailable: 3,
    },
    pin: km === null ? null : { lng: where.lng + 0.3, lat: where.lat },
    clues: [],
    reveal: {
      roundId: `r-${where.id}`,
      distanceKm: km,
      score,
      hintsUsed,
      answer: {
        lng: where.lng,
        lat: where.lat,
        place: where.place,
        country: where.country,
        credit: where.credit,
      },
    },
    atlas:
      atlasScore === undefined
        ? null
        : {
            ...(atlas.guesses[where.id] ?? {
              lng: 1,
              lat: 1,
              confidence: 0.5,
              topCountries: [],
              clues: [],
            }),
            distanceKm: 321,
            score: atlasScore,
          },
  } as RoundResult;
}

const NUMBERS: [number, number, number][] = [
  [12, 4900, 3000],
  [600, 3100, 3300],
  [1800, 1500, 1500],
  [7000, 40, 900],
  [300, 3800, 100],
];

function card(withAtlas = true, hints = 0): ShareCard {
  return shareCard(
    "Daily Five, October 9",
    NUMBERS.map(([km, s, a]) => result(km, s, withAtlas ? a : undefined, undefined, hints)),
    GAME,
  );
}

const words = (c: ShareCard) => shareImageLayout(c).texts.map((t) => t.text);

describe("shareImageLayout", () => {
  it("draws the score, the title, a tile per round in its band's colour and who got closer", () => {
    const layout = shareImageLayout(card());
    expect(layout.width).toBe(IMAGE_SIZE);
    expect(layout.height).toBe(IMAGE_SIZE);
    const w = layout.texts.map((t) => t.text);
    expect(w).toEqual(
      expect.arrayContaining([
        "WHEREABOUT",
        "Daily Five, October 9",
        "13,340",
        "out of 25,000 points",
      ]),
    );
    // Tiles are the 26-px-free rects at the round row, left to right.
    const tiles = layout.rects.filter((r) => r.w === 150);
    expect(tiles.map((r) => r.fill)).toEqual([
      BAND_COLORS[0],
      BAND_COLORS[1],
      BAND_COLORS[2],
      BAND_COLORS[3],
      BAND_COLORS[1],
    ]);
    expect(new Set(tiles.map((r) => r.y)).size).toBe(1);
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].x).toBeGreaterThan(tiles[i - 1].x + 150);
    // Won, lost, tied, lost, won: who got closer under each tile, in order.
    const under = layout.texts.filter((t) =>
      Object.values(VERSUS_WORD).some((v) => v.text === t.text),
    );
    expect(under.map((t) => t.text)).toEqual(["You", "Atlas", "Tie", "Atlas", "You"]);
    expect(w).toContain("Beat Atlas in 2 of 5 rounds");
    expect(w).toContain("example.org/whereabout/?daily");
  });

  it("keeps every shape and word inside the picture", () => {
    for (const layout of [shareImageLayout(card()), shareImageLayout(card(false, 2))]) {
      for (const r of layout.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(IMAGE_SIZE);
        expect(r.y + r.h).toBeLessThanOrEqual(IMAGE_SIZE);
      }
      for (const t of layout.texts) {
        expect(t.x).toBeGreaterThan(0);
        expect(t.x).toBeLessThan(IMAGE_SIZE);
        expect(t.y).toBeGreaterThan(0);
        expect(t.y).toBeLessThan(IMAGE_SIZE);
      }
    }
  });

  it("leaves Atlas out when it played no round, and counts hints when some were taken", () => {
    const w = words(card(false, 1));
    expect(w).not.toContain("You");
    expect(w.some((t) => t.includes("Atlas"))).toBe(false);
    expect(w).toContain("5 hints taken");
    expect(words(card())).not.toContain("0 hints taken");
  });

  it("colours a round with no pin (a Blitz clock ran out) as the farthest band", () => {
    const c = shareCard("Blitz", [result(null, 0, 2000)], GAME);
    expect(shareImageLayout(c).rects.find((r) => r.w === 150)?.fill).toBe(
      BAND_COLORS[DISTANCE_BANDS.length - 1],
    );
  });

  it("draws the same words whichever photos were played, for every photo in the catalog", () => {
    const blank = words(card(true, 1));
    for (let i = 0; i < photos.length; i += 5) {
      const dealt = photos.slice(i, i + 5);
      while (dealt.length < 5) dealt.push(photos[dealt.length]);
      const c = shareCard(
        "Daily Five, October 9",
        dealt.map((p, j) => result(NUMBERS[j][0], NUMBERS[j][1], NUMBERS[j][2], p, 1)),
        GAME,
      );
      const drawn = words(c);
      expect(drawn).toEqual(blank);
      const all = drawn.join("\n");
      for (const p of dealt) {
        for (const part of [p.place, countryName(p.country), p.id, p.credit.author]) {
          if (part) expect(all).not.toContain(part);
        }
        const guessed = atlas.guesses[p.id]?.guessedPlace;
        if (guessed) expect(all).not.toContain(guessed);
      }
    }
  });
});

describe("drawShareImage", () => {
  it("paints the background, then every shape, then every word", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left",
      fillRect: vi.fn(() => calls.push("background")),
      beginPath: vi.fn(),
      roundRect: vi.fn(() => calls.push("rect")),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn((t: string) => calls.push(`text:${t}`)),
    } as unknown as DrawingContext;
    const layout = shareImageLayout(card());
    drawShareImage(ctx, layout);
    expect(calls[0]).toBe("background");
    expect(calls.filter((c) => c === "rect")).toHaveLength(layout.rects.length);
    expect(calls.filter((c) => c.startsWith("text:"))).toEqual(
      layout.texts.map((t) => `text:${t.text}`),
    );
    expect(calls.lastIndexOf("rect")).toBeLessThan(calls.indexOf("text:WHEREABOUT"));
  });
});

describe("shareImageName", () => {
  it("names the file after the game, in plain letters", () => {
    expect(shareImageName(card())).toBe("whereabout-daily-five-october-9.png");
    expect(shareImageName(shareCard("A friend's challenge", [], GAME))).toBe(
      "whereabout-a-friend-s-challenge.png",
    );
    expect(shareImageName(shareCard("", [], GAME))).toBe("whereabout.png");
  });
});

describe("sendShareImage", () => {
  const blob = new Blob(["png"], { type: "image/png" });

  it("sends the picture with the share sheet when the browser can share files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn();
    const outcome = await sendShareImage(
      blob,
      "w.png",
      "words",
      { share, canShare: () => true },
      save,
    );
    expect(outcome).toBe("shared");
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.text).toBe("words");
    expect(data.files).toHaveLength(1);
    expect(data.files?.[0].name).toBe("w.png");
    expect(data.files?.[0].type).toBe("image/png");
    expect(save).not.toHaveBeenCalled();
  });

  it("treats closing the share sheet as a choice", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const save = vi.fn();
    expect(await sendShareImage(blob, "w.png", "", { share, canShare: () => true }, save)).toBe(
      "cancelled",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("downloads instead when files can't be shared, sharing is missing or it fails", async () => {
    const save = vi.fn();
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await sendShareImage(blob, "w.png", "", { share, canShare: () => false }, save)).toBe(
      "downloaded",
    );
    // A share sheet with no canShare can't be asked about files, so it isn't trusted with one.
    expect(await sendShareImage(blob, "w.png", "", { share }, save)).toBe("downloaded");
    expect(await sendShareImage(blob, "w.png", "", {}, save)).toBe("downloaded");
    const broken = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    expect(
      await sendShareImage(blob, "w.png", "", { share: broken, canShare: () => true }, save),
    ).toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(4);
    expect(save).toHaveBeenCalledWith(blob, "w.png");
  });

  it("reports a download the browser refused", async () => {
    const save = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(await sendShareImage(blob, "w.png", "", {}, save)).toBe("failed");
  });
});
