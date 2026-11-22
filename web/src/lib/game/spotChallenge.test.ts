import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { bundledSpotIds } from "./bundled";
import type { GameRecord } from "./deck";
import { spotResult, type SpotResult } from "./spotClue";
import {
  encodeSpotChallenge,
  parseSpotChallenge,
  spotChallengeFrom,
  spotChallengeLine,
  spotChallengeOutcome,
  spotChallengeScore,
  spotChallengeText,
  spotChallengeUrl,
  spotFriendResult,
  spotFriendResults,
  spotHeadToHead,
  type SpotChallenge,
} from "./spotChallenge";
import type { AtlasLooked } from "./types";

const IDS = ["a1", "b2", "c3", "d4", "e5"];
const DEALT = [...IDS, "f6", "g7"];
const HREF = "https://example.org/whereabout/spot-the-clue/?challenge=old#x";

/** A 3 × 3 map: the middle square mattered most, the top left 60% as much, the bottom right 30%. */
const LOOKED: AtlasLooked = {
  grid: 3,
  crop: [0, 0, 1, 1],
  cells: [0.6, 0.1, 0, 0, 1, 0, 0, 0, 0.3],
};

const record = (id: string, looked: AtlasLooked = LOOKED) =>
  ({ photo: { id }, atlas: { looked } }) as unknown as GameRecord;
const RECORDS = new Map(IDS.map((id) => [id, record(id)]));

// The sender: the hottest (1,000), the top left (600), a cold square (0), the bottom right (300)
// and a square past the 3 × 3 grid (0): 1,900 in all.
const C: SpotChallenge = { ids: IDS, cells: [4, 0, 2, 8, 30] };

const play = (cells: number[]): SpotResult[] =>
  cells.map((cell, i) => spotResult(IDS[i]!, LOOKED, cell));

describe("the challenge link", () => {
  it("round-trips through the address", () => {
    const value = encodeSpotChallenge(C);
    expect(value).toBe("a1.b2.c3.d4.e5_4.0.2.8.30");
    expect(parseSpotChallenge(value, DEALT)).toEqual({ ok: true, challenge: C });
  });

  it("is made from a whole game, its photos in order and the square picked on each", () => {
    expect(spotChallengeFrom(play([4, 0, 2, 8, 1]))).toEqual({ ids: IDS, cells: [4, 0, 2, 8, 1] });
  });

  it("keeps only the challenge in the page's address", () => {
    expect(spotChallengeUrl(HREF, C)).toBe(
      "https://example.org/whereabout/spot-the-clue/?challenge=a1.b2.c3.d4.e5_4.0.2.8.30",
    );
  });

  it.each([
    ["", "nothing"],
    ["a1.b2.c3.d4.e5", "no squares"],
    ["a1.b2.c3.d4_4.0.2.8", "four photos"],
    ["a1.b2.c3.d4.e5.f6_4.0.2.8.1.1", "six photos"],
    ["a1.b2.c3.d4.e5_4.0.2.8", "a square short"],
    ["a1.a1.c3.d4.e5_4.0.2.8.1", "a photo twice"],
    ["a1.b2.c3.d4.e5_4.0.2.8.-1", "a negative square"],
    ["a1.b2.c3.d4.e5_4.0.2.8.01", "a padded square"],
    ["a1.b2.c3.d4.e5_4.0.2.8.1.5", "a square too many"],
    ["a1.b2.c3.d4.e5_4.0.2.8.256", "a square past any grid"],
    ["a1.b2.c3.d4.e5_4.0.2.8.x", "a square that isn't a number"],
    ["a1.b2.c3.d4.e5_4.0.2.8.1_9", "a third part"],
    ["a1.b2.c3.d4.e/5_4.0.2.8.1", "a photo id that isn't one"],
  ])("sets aside %j (%s) as malformed", (value) => {
    expect(parseSpotChallenge(value, DEALT)).toEqual({ ok: false, reason: "malformed" });
  });

  it("says when a photo isn't dealt any more", () => {
    expect(parseSpotChallenge("a1.b2.c3.d4.zz_4.0.2.8.1", DEALT)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("takes a challenge over the photos the real game deals", () => {
    const ids = bundledSpotIds.slice(0, 5);
    const parsed = parseSpotChallenge(`${ids.join(".")}_0.24.48.7.13`, bundledSpotIds);
    expect(parsed.ok).toBe(true);
  });
});

describe("the friend's squares", () => {
  it("are scored against each photo's map, the game's own rule", () => {
    expect(spotFriendResult(C, 0, RECORDS)).toEqual({
      id: "a1",
      cell: 4,
      points: 1000,
      hottest: true,
    });
    expect(spotFriendResult(C, 1, RECORDS)!.points).toBe(600);
    expect(spotFriendResult(C, 3, RECORDS)!.points).toBe(300);
    // A square past the photo's grid scores nothing.
    expect(spotFriendResult(C, 4, RECORDS)).toEqual({
      id: "e5",
      cell: 30,
      points: 0,
      hottest: false,
    });
    expect(spotFriendResult(C, 5, RECORDS)).toBeNull();
  });

  it("add up photo by photo, waiting for any map still loading", () => {
    expect(spotChallengeScore(C, RECORDS)).toBe(1900);
    expect(spotChallengeScore(C, RECORDS, 2)).toBe(1600);
    expect(spotChallengeScore(C, RECORDS, 0)).toBe(0);
    const partial = new Map([...RECORDS].filter(([id]) => id !== "d4"));
    expect(spotFriendResult(C, 3, partial)).toBeNull();
    expect(spotChallengeScore(C, partial, 3)).toBe(1600);
    expect(spotChallengeScore(C, partial)).toBeNull();
    expect(spotFriendResults(C, partial)).toBeNull();
  });

  it("never trust a map that isn't playable", () => {
    const blank = new Map(RECORDS);
    blank.set("a1", record("a1", { ...LOOKED, cells: LOOKED.cells.map(() => 0) }));
    expect(spotFriendResult(C, 0, blank)).toBeNull();
  });
});

describe("the end of a challenge", () => {
  const theirs = spotFriendResults(C, RECORDS)!;

  it("calls the game won, lost or tied on the points", () => {
    expect(spotChallengeOutcome(play([4, 4, 0, 8, 8]), theirs)).toBe("won"); // 3,200
    expect(spotChallengeOutcome(play([2, 2, 2, 2, 4]), theirs)).toBe("lost"); // 1,000
    expect(spotChallengeOutcome(play([4, 0, 2, 8, 2]), theirs)).toBe("tied");
  });

  it("says by how much", () => {
    expect(spotChallengeLine(play([4, 4, 0, 8, 8]), theirs)).toBe(
      "You beat your friend's 1,900 by 1,300.",
    );
    expect(spotChallengeLine(play([2, 2, 2, 2, 4]), theirs)).toBe(
      "Your friend's 1,900 wins, by 900.",
    );
    expect(spotChallengeLine(play([4, 0, 2, 8, 2]), theirs)).toBe(
      "A dead heat: you both scored 1,900.",
    );
  });

  it("words a fresh challenge and a reply with numbers only", () => {
    const game = play([4, 4, 0, 8, 8]);
    expect(spotChallengeText(game, HREF)).toBe(
      [
        "Whereabout · Spot the clue: 3,200 points, Atlas's most telling square found on 2 of 5.",
        "Same five photos: can you tell what Atlas looked at?",
        "https://example.org/whereabout/spot-the-clue/?challenge=a1.b2.c3.d4.e5_4.4.0.8.8",
      ].join("\n"),
    );
    expect(spotChallengeText(game, HREF, theirs).split("\n")[1]).toBe(
      "That beats your 1,900. Your turn to read Atlas.",
    );
    expect(spotChallengeText(play([2, 2, 2, 2, 4]), HREF, theirs).split("\n")[1]).toBe(
      "Your 1,900 wins this time. Try them again?",
    );
    expect(spotChallengeText(play([4, 0, 2, 8, 2]), HREF, theirs).split("\n")[1]).toBe(
      "We tied. Play them again to break it?",
    );
  });

  it("draws a head to head of points and verdicts, photo by photo", () => {
    const h = spotHeadToHead(play([4, 4, 0, 8, 8]), theirs, HREF);
    expect(h).toMatchObject({
      game: "Spot the clue",
      youTotal: "3,200 pts",
      friendTotal: "1,900 pts",
      outcome: "won",
    });
    expect(h.rows).toEqual([
      { label: "Photo 1", you: "1,000 · Spot on", friend: "1,000 · Spot on", winner: "tie" },
      { label: "Photo 2", you: "1,000 · Spot on", friend: "600 · Warm", winner: "you" },
      { label: "Photo 3", you: "600 · Warm", friend: "0 · Cold", winner: "you" },
      { label: "Photo 4", you: "300 · Cool", friend: "300 · Cool", winner: "tie" },
      { label: "Photo 5", you: "300 · Cool", friend: "0 · Cold", winner: "you" },
    ]);
  });

  it("draws no photo, place or country from the catalog", () => {
    const ids = bundledSpotIds.slice(0, 5);
    const results = ids.map((id) => spotResult(id, LOOKED, 4));
    const words = headToHeadLayout(spotHeadToHead(results, results, HREF))
      .texts.map((t) => t.text)
      .join("\n");
    for (const id of ids) {
      const p = photos.find((x) => x.id === id)!;
      expect(words).not.toContain(id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(p.country);
    }
  });
});
