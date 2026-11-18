import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { bundledGroundCovers } from "./bundled";
import {
  GROUND_LETTER,
  encodeGroundChallenge,
  groundChallengeFrom,
  groundChallengeLine,
  groundChallengeOutcome,
  groundChallengeScore,
  groundChallengeText,
  groundChallengeUrl,
  groundFriendCall,
  groundHeadToHead,
  parseGroundChallenge,
  type GroundChallenge,
} from "./groundChallenge";
import { answerCode } from "./clueChallenge";
import { dealGround, type GroundMap, type GroundResult } from "./onTheGround";

const COVERS: GroundMap = {
  b1: "Built-up",
  t1: "Tree cover",
  g1: "Grassland",
  w1: "Permanent water bodies",
  s1: "Bare / sparse vegetation",
  b2: "Built-up",
};
// The friend named b1, t1 and s1 right, and g1 and w1 wrong: 3 of 5.
const C: GroundChallenge = {
  ids: ["b1", "g1", "t1", "w1", "s1"],
  calls: ["Built-up", "Tree cover", "Tree cover", "Grassland", "Bare / sparse vegetation"],
};
const VALUE = "b1.g1.t1.w1.s1_bttgs";
const HREF = "https://example.org/whereabout/on-the-ground/?x=1#top";

function result(id: string, picked: GroundResult["picked"]): GroundResult {
  const truth = COVERS[id];
  return { id, picked, truth, correct: picked === truth, atlas: null };
}

/** A game on the friend's photos with `right` of them named right, the first ones. */
function game(right: number): GroundResult[] {
  return C.ids.map((id, i) =>
    result(id, i < right ? COVERS[id] : COVERS[id] === "Grassland" ? "Built-up" : "Grassland"),
  );
}

describe("What's on the ground? challenge links", () => {
  it("carry a letter a cover, the same letters a Clue mix link writes for the ground", () => {
    expect(GROUND_LETTER).toEqual({
      "Built-up": "b",
      "Tree cover": "t",
      Grassland: "g",
      "Permanent water bodies": "w",
      "Bare / sparse vegetation": "s",
    });
    for (const [cover, letter] of Object.entries(GROUND_LETTER)) {
      expect(answerCode("ground", cover)).toBe(letter);
    }
  });

  it("round-trip the photos and the calls", () => {
    expect(encodeGroundChallenge(C)).toBe(VALUE);
    expect(parseGroundChallenge(VALUE, COVERS)).toEqual({ ok: true, challenge: C });
  });

  it("set aside anything that isn't five different photos with a call on each", () => {
    for (const bad of [
      "",
      "b1.g1.t1.w1.s1",
      "b1.g1.t1.w1.s1_bttg",
      "b1.g1.t1.w1.s1_bttgsb",
      "b1.g1.t1.w1.s1_bttgx",
      "b1.g1.t1.w1.s1_BTTGS",
      "b1.g1.t1.w1.s1_ABBCE",
      "b1.g1.t1.w1_bttg",
      "b1.g1.t1.w1.s1.b2_bttgsb",
      "b1.g1.t1.w1.b1_bttgb",
      "b1.g1.t1.w1.s/1_bttgs",
      "b1.g1.t1.w1.s1_bttgs_3",
      `${"x".repeat(33)}.g1.t1.w1.s1_bttgs`,
    ]) {
      expect(parseGroundChallenge(bad, COVERS), bad).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("say when a photo isn't dealt any more, never reading a prototype key as a photo", () => {
    for (const gone of ["b1.g1.t1.w1.zz_bttgs", "b1.g1.t1.w1.constructor_bttgs"]) {
      expect(parseGroundChallenge(gone, COVERS)).toEqual({ ok: false, reason: "missing" });
    }
  });

  it("take a game dealt from the bundled photos", () => {
    const ids = dealGround(bundledGroundCovers, 12345);
    expect(ids).toHaveLength(5);
    const c: GroundChallenge = { ids, calls: ids.map((id) => bundledGroundCovers[id]) };
    expect(parseGroundChallenge(encodeGroundChallenge(c), bundledGroundCovers)).toEqual({
      ok: true,
      challenge: c,
    });
    expect(groundChallengeScore(c, bundledGroundCovers)).toBe(5);
  });

  it("are made from a whole game: its photos and your calls", () => {
    const results = game(2);
    expect(groundChallengeFrom(results)).toEqual({
      ids: C.ids,
      calls: results.map((r) => r.picked),
    });
    expect(groundChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/on-the-ground/?challenge=${VALUE}`,
    );
  });
});

describe("a What's on the ground? challenge's score", () => {
  it("is worked out from the calls against each photo's own label, never carried", () => {
    expect(groundChallengeScore(C, COVERS)).toBe(3);
    // The same calls on photos whose labels say otherwise score otherwise.
    expect(groundChallengeScore(C, { ...COVERS, b1: "Grassland" })).toBe(2);
  });

  it("shows the friend's call photo by photo", () => {
    expect(C.ids.map((_, i) => groundFriendCall(C, i))).toEqual(C.calls);
    expect(groundFriendCall(C, 5)).toBeNull();
  });

  it("decides the game", () => {
    expect(groundChallengeOutcome(4, C, COVERS)).toBe("won");
    expect(groundChallengeOutcome(3, C, COVERS)).toBe("tied");
    expect(groundChallengeOutcome(1, C, COVERS)).toBe("lost");
    expect(groundChallengeLine(4, C, COVERS)).toBe("You beat your friend's 3 of 5 by 1.");
    expect(groundChallengeLine(1, C, COVERS)).toBe("Your friend's 3 of 5 wins, by 2.");
    expect(groundChallengeLine(3, C, COVERS)).toBe("A dead heat: you both named 3 of 5.");
  });
});

describe("the What's on the ground? challenge message", () => {
  it("sends a fresh game as a score and the link, naming no place and no cover", () => {
    const results = game(4);
    const text = groundChallengeText(results, HREF, COVERS);
    expect(text.split("\n")).toEqual([
      "Whereabout · What's on the ground?: I named 4 of 5 covers right.",
      "Same five photos: built-up, trees, grassland, water or bare ground?",
      `https://example.org/whereabout/on-the-ground/?challenge=${encodeGroundChallenge(groundChallengeFrom(results))}`,
    ]);
  });

  it("answers a challenge with how it went", () => {
    const line = (right: number) =>
      groundChallengeText(game(right), HREF, COVERS, C).split("\n")[1];
    expect(line(5)).toBe("That beats your 3. Your turn to read the ground.");
    expect(line(2)).toBe("Your 3 wins this time. Try them again?");
    expect(line(3)).toBe("We tied. Play them again to break it?");
  });
});

describe("the What's on the ground? head to head", () => {
  it("is right or wrong on each photo for both, ringing only the photos where you split", () => {
    const h = groundHeadToHead(game(4), C, COVERS, HREF);
    expect(h).toMatchObject({
      game: "What's on the ground?",
      youTotal: "4 of 5",
      friendTotal: "3 of 5",
      outcome: "won",
    });
    expect(h.rows).toEqual([
      { label: "Photo 1", you: "Right", friend: "Right", winner: "none" },
      { label: "Photo 2", you: "Right", friend: "Wrong", winner: "you" },
      { label: "Photo 3", you: "Right", friend: "Right", winner: "none" },
      { label: "Photo 4", you: "Right", friend: "Wrong", winner: "you" },
      { label: "Photo 5", you: "Wrong", friend: "Right", winner: "friend" },
    ]);
    expect(groundHeadToHead(game(0), C, COVERS, HREF).rows[1].winner).toBe("tie");
  });

  it("draws no photo, place, country or cover from the catalog", () => {
    const ids = dealGround(bundledGroundCovers, 7);
    const c: GroundChallenge = { ids, calls: ids.map(() => "Grassland") };
    const results = ids.map((id) => ({
      id,
      picked: bundledGroundCovers[id],
      truth: bundledGroundCovers[id],
      correct: true,
      atlas: null,
    }));
    const h = groundHeadToHead(results, c, bundledGroundCovers, HREF);
    const words = headToHeadLayout(h)
      .texts.map((t) => t.text)
      .join("\n");
    for (const id of ids) {
      const p = photos.find((x) => x.id === id)!;
      expect(words).not.toContain(id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(bundledGroundCovers[id]);
    }
  });
});
