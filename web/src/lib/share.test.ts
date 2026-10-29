import { describe, expect, it, vi } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { countryName } from "@/lib/countries";
import type { RoundResult } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto } from "@/lib/game/types";

import {
  DISTANCE_BANDS,
  distanceBand,
  sendShare,
  shareCard,
  shareText,
  shareUrl,
  versus,
} from "./share";

const photos = catalog as CatalogPhoto[];
const atlas = atlasData as unknown as AtlasData;

/** A round with the given numbers; where it was is up to `photo`. */
function result(
  km: number,
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
  const guess = photo ? atlas.guesses[photo.id] : undefined;
  return {
    round: {
      roundId: `round-${where.id}`,
      photo: { id: where.id, imageUrl: where.imageUrl },
      hintsAvailable: 3,
    },
    pin: { lng: where.lng + 0.3, lat: where.lat - 0.2 },
    clues: [],
    reveal: {
      roundId: `round-${where.id}`,
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
            ...(guess ?? { lng: 1, lat: 1, confidence: 0.5, topCountries: [], clues: [] }),
            distanceKm: 321,
            score: atlasScore,
          },
  };
}

const GAME = "https://example.org/whereabout/?daily";

describe("distanceBand", () => {
  it("puts each distance in one of four bands, edges inclusive", () => {
    expect(distanceBand(0).square).toBe("🟩");
    expect(distanceBand(25).square).toBe("🟩");
    expect(distanceBand(25.1).square).toBe("🟨");
    expect(distanceBand(750).square).toBe("🟨");
    expect(distanceBand(2500).square).toBe("🟧");
    expect(distanceBand(2500.1).square).toBe("🟥");
    expect(distanceBand(20_000).square).toBe("🟥");
    expect(DISTANCE_BANDS).toHaveLength(4);
  });

  it("puts a Blitz round with no pin in the farthest band", () => {
    expect(distanceBand(null).square).toBe("🟥");
  });
});

describe("versus", () => {
  it("says who got closer, or that Atlas sat it out", () => {
    expect(versus(result(1, 5000, 10))).toBe("won");
    expect(versus(result(1, 10, 5000))).toBe("lost");
    expect(versus(result(1, 300, 300))).toBe("tied");
    expect(versus(result(1, 300))).toBe("none");
  });
});

describe("shareUrl", () => {
  it("keeps the page and ?daily, and drops everything else", () => {
    expect(shareUrl("https://example.org/whereabout/?daily#round-3")).toBe(
      "https://example.org/whereabout/?daily",
    );
    expect(shareUrl("https://example.org/whereabout/?daily=&photo=wm001&lat=48.8")).toBe(
      "https://example.org/whereabout/?daily",
    );
    expect(shareUrl("https://example.org/whereabout/?photo=wm001#x")).toBe(
      "https://example.org/whereabout/",
    );
  });

  it("keeps a past Daily Five's day, and nothing but a real day", () => {
    expect(shareUrl("https://example.org/whereabout/?daily=2026-10-20&lat=1")).toBe(
      "https://example.org/whereabout/?daily=2026-10-20",
    );
    expect(shareUrl("https://example.org/whereabout/?daily=Paris")).toBe(
      "https://example.org/whereabout/?daily",
    );
  });
});

describe("shareText", () => {
  it("is the title, score, one square per round and the link when Atlas sat out", () => {
    const text = shareText(
      shareCard(
        "Daily Five, October 9",
        [
          result(10, 4967),
          result(400, 3846),
          result(2000, 1318),
          result(9000, 12),
          result(700, 3136),
        ],
        GAME,
      ),
    );
    expect(text).toBe(
      [
        "Whereabout: Daily Five, October 9",
        "13,279 / 25,000",
        "🟩🟨🟧🟥🟨",
        "https://example.org/whereabout/?daily",
      ].join("\n"),
    );
  });

  it("adds a row of who got closer, the head-to-head and the hints taken", () => {
    const text = shareText(
      shareCard(
        "Fresh game",
        [
          result(1, 5000, 10),
          result(1, 10, 5000, undefined, 2),
          result(30, 300, 300),
          result(5000, 0),
        ],
        "https://example.org/whereabout/",
      ),
    );
    expect(text.split("\n")).toEqual([
      "Whereabout: Fresh game",
      "5,310 / 25,000",
      "🟩🟩🟨🟥",
      "✅❌🤝▫️",
      "Beat Atlas in 1 of 3 rounds",
      "2 hints taken",
      "https://example.org/whereabout/",
    ]);
  });
});

describe("the share card gives nothing away", () => {
  // Every line must be one of these shapes: fixed words, numbers, squares and marks.
  const ALLOWED = [
    /^Whereabout: (Daily Five, [A-Z][a-z]+ \d{1,2}|Fresh game)$/,
    /^[\d,]+ \/ [\d,]+$/,
    /^[🟩🟨🟧🟥]+$/u,
    /^(✅|❌|🤝|▫️)+$/u,
    /^Beat Atlas in \d of \d rounds$/,
    /^\d+ hints? taken$/,
    /^https:\/\/example\.org\/whereabout\/(\?daily)?$/,
  ];

  it("is the same text whichever photos were played, for every photo in the catalog", () => {
    // Same numbers, five blank rounds: whatever the real card says must match this exactly.
    const numbers: [number, number, number][] = [
      [12, 4900, 3000],
      [600, 3100, 3300],
      [1800, 1500, 1500],
      [7000, 40, 900],
      [300, 3800, 100],
    ];
    const blank = shareText(
      shareCard(
        "Daily Five, October 9",
        numbers.map(([km, s, a]) => result(km, s, a, undefined, 1)),
        GAME,
      ),
    );
    for (const line of blank.split("\n")) {
      expect(
        ALLOWED.some((re) => re.test(line)),
        line,
      ).toBe(true);
    }

    for (let i = 0; i < photos.length; i += 5) {
      const dealt = photos.slice(i, i + 5);
      while (dealt.length < 5) dealt.push(photos[dealt.length]);
      const results = dealt.map((p, j) =>
        result(numbers[j][0], numbers[j][1], numbers[j][2], p, 1),
      );
      const text = shareText(shareCard("Daily Five, October 9", results, GAME));
      expect(text).toBe(blank);
      for (const p of dealt) {
        for (const part of [p.place, countryName(p.country), p.id, p.credit.author]) {
          if (part) expect(text).not.toContain(part);
        }
        expect(text).not.toContain(p.lat.toFixed(1));
        const guessed = atlas.guesses[p.id]?.guessedPlace;
        if (guessed) expect(text).not.toContain(guessed);
      }
    }
  });
});

describe("sendShare", () => {
  it("uses the share sheet when the browser has one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await sendShare("hi", { share, clipboard: { writeText } })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Whereabout", text: "hi" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats closing the share sheet as a choice, not a failure", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const writeText = vi.fn();
    expect(await sendShare("hi", { share, clipboard: { writeText } })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies instead when sharing is missing, refused or fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await sendShare("hi", { clipboard: { writeText } })).toBe("copied");
    expect(
      await sendShare("hi", { share: vi.fn(), canShare: () => false, clipboard: { writeText } }),
    ).toBe("copied");
    const broken = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    expect(await sendShare("hi", { share: broken, clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(3);
  });

  it("reports a blocked clipboard", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    expect(await sendShare("hi", { clipboard: { writeText } })).toBe("failed");
    expect(await sendShare("hi", {})).toBe("failed");
  });
});
