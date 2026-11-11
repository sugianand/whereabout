import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { countryName } from "@/lib/countries";
import type { Challenge } from "@/lib/game/challenge";
import type { RoundResult } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto } from "@/lib/game/types";

import {
  MAX_ROWS,
  OUTCOME_HEADLINE,
  fivePhotoHeadToHead,
  headToHeadLayout,
  headToHeadName,
  headToHeadSummary,
  runHeadToHead,
  shownRows,
  siteAddress,
  type HeadToHead,
  type HeadToHeadRow,
} from "./headToHead";
import { IMAGE_SIZE, INK } from "./shareImage";

const photos = catalog as CatalogPhoto[];
const atlas = atlasData as unknown as AtlasData;
const PAGE = "https://example.org/whereabout/?challenge=wm001.wm002.wm003.wm004.wm005_1.2.3.4.5";

/** A finished round on `photo` worth `score`, with the seconds left when the clock is on. */
function round(photo: CatalogPhoto, score: number, secondsLeft?: number): RoundResult {
  return {
    round: { roundId: `r-${photo.id}`, photo: { id: photo.id, imageUrl: photo.imageUrl } },
    pin: { lng: photo.lng, lat: photo.lat },
    clues: [],
    reveal: {
      roundId: `r-${photo.id}`,
      distanceKm: 10,
      score,
      hintsUsed: 0,
      answer: {
        lng: photo.lng,
        lat: photo.lat,
        place: photo.place,
        country: photo.country,
        credit: photo.credit,
      },
    },
    atlas: null,
    ...(secondsLeft === undefined ? {} : { secondsLeft }),
  } as unknown as RoundResult;
}

const MINE = [5000, 0, 1200, 4800, 2999];
const THEIRS = [4000, 3000, 1200, 4800, 3000];

function game(dealt = photos.slice(0, 5), timed = false) {
  const results = dealt.map((p, i) => round(p, MINE[i], timed ? [12, 0, 3, 30, 1][i] : undefined));
  const friend: Challenge = {
    ids: dealt.map((p) => p.id),
    scores: THEIRS,
    ...(timed ? { secondsLeft: [20, 5, 0, 30, 2] } : {}),
  };
  return fivePhotoHeadToHead(timed ? "Blitz" : "Five photos", results, friend, PAGE);
}

const words = (h: HeadToHead) => headToHeadLayout(h).texts.map((t) => t.text);

describe("fivePhotoHeadToHead", () => {
  it("lists both scores on every photo, calls each photo and the game on points", () => {
    const h = game();
    expect(h.youTotal).toBe("13,999 pts");
    expect(h.friendTotal).toBe("16,000 pts");
    expect(h.outcome).toBe("lost");
    expect(h.rows.map((r) => r.label)).toEqual([
      "Photo 1",
      "Photo 2",
      "Photo 3",
      "Photo 4",
      "Photo 5",
    ]);
    expect(h.rows.map((r) => [r.you, r.friend])).toEqual([
      ["5,000", "4,000"],
      ["0", "3,000"],
      ["1,200", "1,200"],
      ["4,800", "4,800"],
      ["2,999", "3,000"],
    ]);
    expect(h.rows.map((r) => r.winner)).toEqual(["you", "friend", "tie", "tie", "friend"]);
    expect(headToHeadSummary(h)).toBe("Your friend won: you 13,999 pts, your friend 16,000 pts.");
  });

  it("shows each side's seconds left on a Blitz, and still calls photos on points", () => {
    const h = game(photos.slice(0, 5), true);
    expect(h.game).toBe("Blitz");
    expect(h.rows.map((r) => [r.you, r.friend])).toEqual([
      ["5,000 · 12s", "4,000 · 20s"],
      ["0 · time up", "3,000 · 5s"],
      ["1,200 · 3s", "1,200 · time up"],
      ["4,800 · 30s", "4,800 · 30s"],
      ["2,999 · 1s", "3,000 · 2s"],
    ]);
    expect(h.rows[2].winner).toBe("tie");
  });

  it("calls a win and a dead heat", () => {
    const dealt = photos.slice(0, 5);
    const results = dealt.map((p, i) => round(p, THEIRS[i] + (i === 0 ? 1 : 0)));
    const friend = { ids: dealt.map((p) => p.id), scores: THEIRS };
    expect(fivePhotoHeadToHead("Five photos", results, friend, PAGE).outcome).toBe("won");
    const level = dealt.map((p, i) => round(p, THEIRS[i]));
    const tied = fivePhotoHeadToHead("Five photos", level, friend, PAGE);
    expect(tied.outcome).toBe("tied");
    expect(headToHeadSummary(tied)).toMatch(/^A dead heat:/);
  });
});

describe("headToHeadLayout", () => {
  it("draws the call, both totals under their names, and a row per photo", () => {
    const layout = headToHeadLayout(game());
    expect(layout.width).toBe(IMAGE_SIZE);
    expect(layout.height).toBe(IMAGE_SIZE);
    const w = layout.texts.map((t) => t.text);
    expect(w).toEqual(
      expect.arrayContaining([
        "WHEREABOUT",
        "Five photos: head to head",
        "Your friend won",
        "You",
        "Friend",
        "13,999 pts",
        "16,000 pts",
      ]),
    );
    const headline = layout.texts.find((t) => t.text === "Your friend won")!;
    expect(headline.color).toBe(OUTCOME_HEADLINE.lost.color);
    // Rows top to bottom, inside the frame and above the address.
    const labels = layout.texts.filter((t) => t.text.startsWith("Photo "));
    expect(labels).toHaveLength(5);
    for (let i = 1; i < labels.length; i++) expect(labels[i].y).toBeGreaterThan(labels[i - 1].y);
    expect(labels.at(-1)!.y).toBeLessThan(990);
  });

  it("rings the winner's result on each row in their colour, both on a tie", () => {
    const layout = headToHeadLayout(game());
    const pills = layout.rects.filter((r) => r.stroke && r.stroke !== INK.frame);
    // Photo 1 you, photo 2 friend, photos 3 and 4 both, photo 5 friend.
    expect(pills.map((p) => p.stroke)).toEqual([
      INK.sonar,
      INK.flare,
      INK.gold,
      INK.gold,
      INK.gold,
      INK.gold,
      INK.flare,
    ]);
    const first = layout.texts.find((t) => t.text === "5,000")!;
    expect(first.color).toBe(INK.sonar);
    const lost = layout.texts.find((t) => t.text === "0")!;
    expect(lost.color).toBe(INK.chalk);
  });

  it("shrinks the results together until a Blitz row's longest fits its column", () => {
    const px = (h: HeadToHead, word: string) =>
      Number(/(\d+)px/.exec(headToHeadLayout(h).texts.find((t) => t.text === word)!.font)![1]);
    const plain = px(game(), "5,000");
    const timed = game(photos.slice(0, 5), true);
    expect(px(timed, "5,000 · 12s")).toBeLessThan(plain);
    expect(px(timed, "5,000 · 12s")).toBe(px(timed, "1,200 · time up"));
    expect(px(timed, "1,200 · time up") * 0.56 * "1,200 · time up".length).toBeLessThan(264);
  });

  it("draws the page to play on, never the challenge link's photo ids", () => {
    const w = words(game());
    expect(w).toContain("example.org/whereabout/");
    expect(w.join("\n")).not.toContain("wm001");
  });

  it("draws the same words whichever photos were played, for every photo in the catalog", () => {
    const blank = words(game());
    for (let i = 0; i + 5 <= photos.length; i += 5) {
      const dealt = photos.slice(i, i + 5);
      const drawn = words(game(dealt));
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

  it("fits a long run: the first rows, then a count of the rest, all inside the frame", () => {
    const rows: HeadToHeadRow[] = Array.from({ length: 30 }, (_, i) => ({
      label: `Photo ${i + 1}`,
      you: "✓",
      friend: i < 20 ? "✓" : "",
      winner: "none",
    }));
    const kept = shownRows(rows);
    expect(kept).toHaveLength(MAX_ROWS);
    expect(kept.at(-1)!.label).toBe(`+${30 - (MAX_ROWS - 1)} more`);
    expect(shownRows(rows.slice(0, MAX_ROWS))).toHaveLength(MAX_ROWS);
    const layout = headToHeadLayout({ ...game(), rows });
    const labels = layout.texts.filter((t) => /^(Photo \d+|\+\d+ more)$/.test(t.text));
    expect(labels).toHaveLength(MAX_ROWS);
    expect(labels.at(-1)!.y).toBeLessThan(990);
  });
});

describe("names and addresses", () => {
  it("names the file after the game", () => {
    expect(headToHeadName(game())).toBe("whereabout-five-photos-head-to-head.png");
    expect(headToHeadName(game(photos.slice(0, 5), true))).toBe(
      "whereabout-blitz-head-to-head.png",
    );
  });

  it("keeps the host and path of the page, and nothing of a bad address", () => {
    expect(siteAddress("https://sugianand.github.io/whereabout/?challenge=x#y")).toBe(
      "sugianand.github.io/whereabout/",
    );
    expect(siteAddress("not a url")).toBe("");
  });
});

describe("runHeadToHead", () => {
  const QUAD = { one: "Quad", many: "Quads" };

  it("lists both runs call by call as far as the longer went, ringing only where they split", () => {
    const h = runHeadToHead("Odd one out", QUAD, { streak: 3, missed: true }, { streak: 1, missed: true }, PAGE);
    expect([h.game, h.youTotal, h.friendTotal, h.outcome]).toEqual([
      "Odd one out",
      "3 in a row",
      "1 in a row",
      "won",
    ]);
    expect(h.rows).toEqual([
      { label: "Quad 1", you: "Right", friend: "Right", winner: "none" },
      { label: "Quad 2", you: "Right", friend: "Wrong", winner: "you" },
      { label: "Quad 3", you: "Right", friend: "—", winner: "you" },
      { label: "Quad 4", you: "Wrong", friend: "—", winner: "none" },
    ]);
  });

  it("calls a loss, and a dead heat whose shared miss rings both", () => {
    const lost = runHeadToHead("Odd one out", QUAD, { streak: 0, missed: true }, { streak: 2, missed: true }, PAGE);
    expect(lost.outcome).toBe("lost");
    expect(lost.rows.map((r) => [r.you, r.friend, r.winner])).toEqual([
      ["Wrong", "Right", "friend"],
      ["—", "Right", "friend"],
      ["—", "Wrong", "none"],
    ]);
    const tied = runHeadToHead("Odd one out", QUAD, { streak: 1, missed: true }, { streak: 1, missed: true }, PAGE);
    expect(tied.outcome).toBe("tied");
    expect(tied.rows.at(-1)).toEqual({ label: "Quad 2", you: "Wrong", friend: "Wrong", winner: "tie" });
  });

  it("shows no miss for a run that ran out of photos or a link that stops before it", () => {
    const h = runHeadToHead("Odd one out", QUAD, { streak: 2, missed: false }, { streak: 2, missed: false }, PAGE);
    expect(h.outcome).toBe("tied");
    expect(h.rows.map((r) => [r.you, r.friend, r.winner])).toEqual([
      ["Right", "Right", "none"],
      ["Right", "Right", "none"],
    ]);
  });

  it("folds a long run's stretches into ranges, keeping where each run ended", () => {
    const h = runHeadToHead("Odd one out", QUAD, { streak: 20, missed: true }, { streak: 35, missed: false }, PAGE);
    expect(h.rows).toEqual([
      { label: "Quads 1–20", you: "Right", friend: "Right", winner: "none" },
      { label: "Quad 21", you: "Wrong", friend: "Right", winner: "friend" },
      { label: "Quads 22–35", you: "—", friend: "Right", winner: "friend" },
    ]);
    // A run that fits stays call by call.
    const fits = runHeadToHead("Odd one out", QUAD, { streak: MAX_ROWS - 1, missed: true }, { streak: 0, missed: true }, PAGE);
    expect(fits.rows).toHaveLength(MAX_ROWS);
    expect(fits.rows.every((r) => !r.label.includes("–"))).toBe(true);
  });

  it("draws every folded row inside the frame", () => {
    const layout = headToHeadLayout(
      runHeadToHead("Odd one out", QUAD, { streak: 40, missed: true }, { streak: 9, missed: true }, PAGE),
    );
    const words = layout.texts.map((t) => t.text);
    expect(words).toEqual(expect.arrayContaining(["Quads 1–9", "Quad 10", "Quads 11–40", "Quad 41"]));
    for (const t of layout.texts) expect(t.y).toBeLessThan(IMAGE_SIZE - 32);
  });
});
