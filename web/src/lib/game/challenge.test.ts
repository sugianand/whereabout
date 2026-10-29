import { describe, expect, it } from "vitest";

import catalog from "@/data/photos.json";
import type { RoundResult } from "@/lib/game/state";
import type { CatalogPhoto } from "@/lib/game/types";

import {
  challengeFrom,
  challengeOutcome,
  challengeText,
  challengeUrl,
  encodeChallenge,
  parseChallenge,
} from "./challenge";

const photos = catalog as CatalogPhoto[];
const deck = photos.map((p) => p.id);

function result(photo: CatalogPhoto, score: number): RoundResult {
  return {
    round: {
      roundId: `round-${photo.id}`,
      photo: { id: photo.id, imageUrl: photo.imageUrl },
      hintsAvailable: 3,
    },
    pin: { lng: photo.lng + 1, lat: photo.lat },
    clues: [],
    reveal: {
      roundId: `round-${photo.id}`,
      distanceKm: 100,
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
  };
}

const five = photos.slice(10, 15);
const scores = [4210, 3100, 0, 5000, 1234];
const game = five.map((p, i) => result(p, scores[i]));

describe("challenge links", () => {
  it("round-trip a finished game's photos and scores", () => {
    const c = challengeFrom(game);
    expect(c).toEqual({ ids: five.map((p) => p.id), scores });
    expect(parseChallenge(encodeChallenge(c), deck)).toEqual({ ok: true, challenge: c });
  });

  it("survive the address bar", () => {
    const url = challengeUrl("https://x.org/whereabout/?tier=hard#top", challengeFrom(game));
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://x.org/whereabout/");
    expect([...parsed.searchParams.keys()]).toEqual(["challenge"]);
    expect(parseChallenge(parsed.searchParams.get("challenge")!, deck)).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["", "nothing"],
    ["a.b.c.d.e", "no scores"],
    [`${deck.slice(0, 4).join(".")}_1.2.3.4`, "four photos"],
    [`${deck.slice(0, 6).join(".")}_1.2.3.4.5.6`, "six photos"],
    [`${[deck[0], deck[0], ...deck.slice(1, 4)].join(".")}_1.2.3.4.5`, "a photo twice"],
    [`${deck.slice(0, 5).join(".")}_1.2.3.4`, "four scores"],
    [`${deck.slice(0, 5).join(".")}_1.2.3.4.5001`, "a score over 5,000"],
    [`${deck.slice(0, 5).join(".")}_1.2.-3.4.5`, "a negative score"],
    [`${deck.slice(0, 5).join(".")}_1.2.3.5.4.5`, "a fractional score"],
    [`${deck.slice(0, 5).join(".")}_1.2.3.4.5_6`, "a third part"],
    [`${deck.slice(0, 4).join(".")}.../x_1.2.3.4.5`, "a path in an id"],
  ])("refuse %j (%s)", (value) => {
    expect(parseChallenge(value, deck)).toEqual({ ok: false, reason: "malformed" });
  });

  it("say when the photos are no longer in the game", () => {
    const value = `${deck.slice(0, 4).join(".")}.gone1_1.2.3.4.5`;
    expect(parseChallenge(value, deck)).toEqual({ ok: false, reason: "missing" });
  });

  it("carry no place, country or coordinate", () => {
    const text = challengeText(game, "https://x.org/whereabout/");
    for (const p of five) {
      expect(text).not.toContain(p.place);
      expect(text).not.toContain(String(p.lat));
      expect(text).not.toContain(String(p.lng));
    }
    expect(text).toContain("13,544");
    expect(text).toContain("Can you beat me?");
  });

  it("answer a challenge with who won", () => {
    const base = { ids: five.map((p) => p.id) };
    const lower = challengeText(game, "https://x.org/", { ...base, scores: [0, 0, 0, 0, 1] });
    expect(lower).toContain("I beat your score.");
    const higher = challengeText(game, "https://x.org/", {
      ...base,
      scores: [5000, 5000, 5000, 0, 0],
    });
    expect(higher).toContain("You beat me this time.");
    const same = challengeText(game, "https://x.org/", { ...base, scores });
    expect(same).toContain("We tied.");
    // The link sent back carries the answering player's own scores.
    expect(same).toMatch(new RegExp(`_${scores.join("\\.")}$`));
  });

  it("decide the winner on total points", () => {
    expect(challengeOutcome(10, 9)).toBe("won");
    expect(challengeOutcome(9, 10)).toBe("lost");
    expect(challengeOutcome(10, 10)).toBe("tied");
  });
});
