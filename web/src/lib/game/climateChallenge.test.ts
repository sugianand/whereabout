import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { bundledClimateGroups } from "./bundled";
import {
  KOPPEN_LETTER,
  climateChallengeFrom,
  climateChallengeLine,
  climateChallengeOutcome,
  climateChallengeScore,
  climateChallengeText,
  climateChallengeUrl,
  climateHeadToHead,
  encodeClimateChallenge,
  friendCall,
  parseClimateChallenge,
  type ClimateChallenge,
} from "./climateChallenge";
import { dealClimate, type ClimateMap, type ClimateResult } from "./whichClimate";

const GROUPS: ClimateMap = {
  t1: "Tropical",
  a1: "Arid",
  m1: "Temperate",
  c1: "Continental",
  p1: "Polar",
  m2: "Temperate",
};
// The friend named t1, a1 and p1 right, and m1 and c1 wrong: 3 of 5.
const C: ClimateChallenge = {
  ids: ["t1", "m1", "a1", "c1", "p1"],
  calls: ["Tropical", "Arid", "Arid", "Temperate", "Polar"],
};
const VALUE = "t1.m1.a1.c1.p1_ABBCE";
const HREF = "https://example.org/whereabout/which-climate/?x=1#top";

function result(id: string, picked: ClimateResult["picked"]): ClimateResult {
  const truth = GROUPS[id];
  return { id, picked, truth, correct: picked === truth, atlas: null };
}

/** A game on the friend's photos with `right` of them named right, the first ones. */
function game(right: number): ClimateResult[] {
  return C.ids.map((id, i) =>
    result(id, i < right ? GROUPS[id] : GROUPS[id] === "Polar" ? "Arid" : "Polar"),
  );
}

describe("Which climate? challenge links", () => {
  it("carry Köppen's own letters, A tropical to E polar", () => {
    expect(KOPPEN_LETTER).toEqual({
      Tropical: "A",
      Arid: "B",
      Temperate: "C",
      Continental: "D",
      Polar: "E",
    });
  });

  it("round-trip the photos and the calls", () => {
    expect(encodeClimateChallenge(C)).toBe(VALUE);
    expect(parseClimateChallenge(VALUE, GROUPS)).toEqual({ ok: true, challenge: C });
  });

  it("set aside anything that isn't five different photos with a call on each", () => {
    for (const bad of [
      "",
      "t1.m1.a1.c1.p1",
      "t1.m1.a1.c1.p1_ABBC",
      "t1.m1.a1.c1.p1_ABBCEA",
      "t1.m1.a1.c1.p1_ABBCF",
      "t1.m1.a1.c1.p1_abbce",
      "t1.m1.a1.c1_ABBC",
      "t1.m1.a1.c1.p1.m2_ABBCEC",
      "t1.m1.a1.c1.t1_ABBCA",
      "t1.m1.a1.c1.p/1_ABBCE",
      "t1.m1.a1.c1.p1_ABBCE_3",
      `${"x".repeat(33)}.m1.a1.c1.p1_ABBCE`,
    ]) {
      expect(parseClimateChallenge(bad, GROUPS), bad).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("say when a photo isn't dealt any more, never reading a prototype key as a photo", () => {
    for (const gone of ["t1.m1.a1.c1.zz_ABBCE", "t1.m1.a1.c1.constructor_ABBCE"]) {
      expect(parseClimateChallenge(gone, GROUPS)).toEqual({ ok: false, reason: "missing" });
    }
  });

  it("take a game dealt from the bundled photos", () => {
    const ids = dealClimate(bundledClimateGroups, 12345);
    expect(ids).toHaveLength(5);
    const c: ClimateChallenge = { ids, calls: ids.map((id) => bundledClimateGroups[id]) };
    expect(parseClimateChallenge(encodeClimateChallenge(c), bundledClimateGroups)).toEqual({
      ok: true,
      challenge: c,
    });
    expect(climateChallengeScore(c, bundledClimateGroups)).toBe(5);
  });

  it("are made from a whole game: its photos and your calls", () => {
    const results = game(2);
    expect(climateChallengeFrom(results)).toEqual({
      ids: C.ids,
      calls: results.map((r) => r.picked),
    });
    expect(climateChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/which-climate/?challenge=${VALUE}`,
    );
  });
});

describe("a Which climate? challenge's score", () => {
  it("is worked out from the calls against each photo's own label, never carried", () => {
    expect(climateChallengeScore(C, GROUPS)).toBe(3);
    // The same calls on photos whose labels say otherwise score otherwise.
    expect(climateChallengeScore(C, { ...GROUPS, t1: "Arid" })).toBe(2);
  });

  it("shows the friend's call photo by photo", () => {
    expect(C.ids.map((_, i) => friendCall(C, i))).toEqual(C.calls);
    expect(friendCall(C, 5)).toBeNull();
  });

  it("decides the game", () => {
    expect(climateChallengeOutcome(4, C, GROUPS)).toBe("won");
    expect(climateChallengeOutcome(3, C, GROUPS)).toBe("tied");
    expect(climateChallengeOutcome(1, C, GROUPS)).toBe("lost");
    expect(climateChallengeLine(4, C, GROUPS)).toBe("You beat your friend's 3 of 5 by 1.");
    expect(climateChallengeLine(1, C, GROUPS)).toBe("Your friend's 3 of 5 wins, by 2.");
    expect(climateChallengeLine(3, C, GROUPS)).toBe("A dead heat: you both named 3 of 5.");
  });
});

describe("the Which climate? challenge message", () => {
  it("sends a fresh game as a score and the link, naming no place and no climate", () => {
    const results = game(4);
    const text = climateChallengeText(results, HREF, GROUPS);
    expect(text.split("\n")).toEqual([
      "Whereabout · Which climate?: I named 4 of 5 climates right.",
      "Same five photos: tropical, arid, temperate, continental or polar?",
      `https://example.org/whereabout/which-climate/?challenge=${encodeClimateChallenge(climateChallengeFrom(results))}`,
    ]);
  });

  it("answers a challenge with how it went", () => {
    const line = (right: number) =>
      climateChallengeText(game(right), HREF, GROUPS, C).split("\n")[1];
    expect(line(5)).toBe("That beats your 3. Your turn to read the weather.");
    expect(line(2)).toBe("Your 3 wins this time. Try them again?");
    expect(line(3)).toBe("We tied. Play them again to break it?");
  });
});

describe("the Which climate? head to head", () => {
  it("is right or wrong on each photo for both, ringing only the photos where you split", () => {
    const h = climateHeadToHead(game(4), C, GROUPS, HREF);
    expect(h).toMatchObject({
      game: "Which climate?",
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
    expect(climateHeadToHead(game(0), C, GROUPS, HREF).rows[1].winner).toBe("tie");
  });

  it("draws no photo, place, country or climate from the catalog", () => {
    const ids = dealClimate(bundledClimateGroups, 7);
    const c: ClimateChallenge = { ids, calls: ids.map(() => "Polar") };
    const results = ids.map((id) => ({
      id,
      picked: bundledClimateGroups[id],
      truth: bundledClimateGroups[id],
      correct: true,
      atlas: null,
    }));
    const h = climateHeadToHead(results, c, bundledClimateGroups, HREF);
    const words = headToHeadLayout(h)
      .texts.map((t) => t.text)
      .join("\n");
    for (const id of ids) {
      const p = photos.find((x) => x.id === id)!;
      expect(words).not.toContain(id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(bundledClimateGroups[id]);
    }
  });
});
