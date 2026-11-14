import { describe, expect, it } from "vitest";

import { CONTINENTS } from "@/lib/continents";
import { headToHeadLayout } from "@/lib/headToHead";

import { bundledClimateGroups, bundledContinents, bundledDrivingSides } from "./bundled";
import {
  CLUE_CHALLENGE_PHOTOS,
  answerCode,
  clueAt,
  clueChallengeFrom,
  clueChallengeLine,
  clueChallengeOrder,
  clueChallengeText,
  clueHeadToHead,
  codeAnswer,
  encodeClueChallenge,
  endsOnMiss,
  friendMissAnswer,
  parseClueChallenge,
  type ClueChallenge,
} from "./clueChallenge";
import { CLUE_CYCLE, clueAnswers, clueTruth, dealClueMix, type ClueMaps } from "./clueMix";

// A small deck with two answers or more to every clue, so the deal goes a few steps.
const MAPS: ClueMaps = {
  sides: { a: "left", b: "right", c: "right", d: "left", e: "right", f: "left", g: "right" },
  climates: {
    a: "Temperate",
    b: "Arid",
    c: "Tropical",
    d: "Polar",
    e: "Temperate",
    f: "Arid",
    g: "Continental",
  },
  continents: {
    a: "Europe",
    b: "Asia",
    c: "Africa",
    d: "Oceania",
    e: "Europe",
    f: "Asia",
    g: "North America",
  },
};
// The road on a (left, called right), the climate on b (Arid, called right), then the continent
// on c, which is in Africa, where the sender said Europe.
const C: ClueChallenge = { ids: ["a", "b", "c"], seed: 4_000_000_000, streak: 2, miss: "Europe" };
const HREF = "https://example.org/whereabout/clue-mix/?x=1#top";
const BUNDLED: ClueMaps = {
  sides: bundledDrivingSides,
  climates: bundledClimateGroups,
  continents: bundledContinents,
};

describe("clue codes", () => {
  it("give every answer of every clue its own code, read back the same", () => {
    for (const clue of CLUE_CYCLE) {
      const answers = clue === "continent" ? CONTINENTS : clueAnswers(clue, BUNDLED);
      const codes = answers.map((a) => answerCode(clue, a));
      expect(new Set(codes).size).toBe(codes.length);
      answers.forEach((a) => expect(codeAnswer(clue, answerCode(clue, a))).toBe(a));
    }
    expect(answerCode("road", "left")).toBe("l");
    expect(answerCode("climate", "Polar")).toBe("E");
    expect(answerCode("continent", "South America")).toBe("sa");
    expect(codeAnswer("climate", "eu")).toBeNull();
    expect(() => answerCode("road", "middle")).toThrow();
  });
});

describe("encode and parse", () => {
  it("round-trips a run that ended on a miss, with the miss as its clue's code", () => {
    const value = encodeClueChallenge(C);
    expect(value).toBe(`a.b.c_${(4_000_000_000).toString(36)}_2_eu`);
    expect(parseClueChallenge(value, MAPS)).toEqual({ ok: true, challenge: C });
  });

  it("round-trips a run with no miss to show", () => {
    const cleared: ClueChallenge = { ids: ["a", "b"], seed: 9, streak: 2, miss: null };
    expect(encodeClueChallenge(cleared)).toBe("a.b_9_2");
    expect(parseClueChallenge("a.b_9_2", MAPS)).toEqual({ ok: true, challenge: cleared });
  });

  it("reads the miss by the last step's clue: a road call, a Köppen letter", () => {
    // a's road is left, so r was the miss.
    expect(parseClueChallenge("a_1_0_r", MAPS)).toEqual({
      ok: true,
      challenge: { ids: ["a"], seed: 1, streak: 0, miss: "right" },
    });
    // b's climate is Arid (B), so D was a miss.
    expect(parseClueChallenge("a.b_1_1_D", MAPS)).toEqual({
      ok: true,
      challenge: { ids: ["a", "b"], seed: 1, streak: 1, miss: "Continental" },
    });
  });

  it.each([
    ["no parts", ""],
    ["too few parts", "a.b.c_1"],
    ["too many parts", "a.b.c_1_2_eu_x"],
    ["a bad id", "a.b!.c_1_2_eu"],
    ["a repeated photo", "a.a.c_1_2_eu"],
    ["a seed past 32 bits", `a.b.c_${(2 ** 32).toString(36)}_2_eu`],
    ["a streak the photos can't give", "a.b.c_1_1_eu"],
    ["a miss with no miss to show", "a.b.c_1_3_eu"],
    ["a miss missing", "a.b.c_1_2"],
    ["a miss code for another clue", "a.b.c_1_2_D"],
    ["a miss that names no answer", "a.b.c_1_2_zz"],
    ["a 'miss' that was the right answer", "a.b.c_1_2_af"],
  ])("refuses %s", (_, value) => {
    expect(parseClueChallenge(value, MAPS)).toEqual({ ok: false, reason: "malformed" });
  });

  it("says photos are missing when one isn't dealt or lacks its step's clue", () => {
    expect(parseClueChallenge("a.zz.c_1_2_eu", MAPS)).toEqual({ ok: false, reason: "missing" });
    const noClimate = { ...MAPS, climates: { a: "Arid" as const } };
    expect(parseClueChallenge("a.b.c_1_2_eu", noClimate)).toEqual({
      ok: false,
      reason: "missing",
    });
    // A photo is only asked its own step's clue, so a photo with no road is fine second.
    const noRoad = { ...MAPS, sides: { a: "left" as const } };
    expect(parseClueChallenge("a.b.c_1_2_eu", noRoad).ok).toBe(true);
  });

  it("takes a full link with a streak past it, and nothing longer", () => {
    const ids = Array.from({ length: CLUE_CHALLENGE_PHOTOS }, (_, i) => `p${i}`);
    const maps: ClueMaps = {
      sides: Object.fromEntries(ids.map((id) => [id, "left"])),
      climates: Object.fromEntries(ids.map((id) => [id, "Arid"])),
      continents: Object.fromEntries(ids.map((id) => [id, "Asia"])),
    };
    expect(parseClueChallenge(`${ids.join(".")}_1_75`, maps).ok).toBe(true);
    expect(parseClueChallenge(`${ids.join(".")}.px_1_75`, maps)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("clueChallengeOrder", () => {
  it("plays the sender's steps first, asking their clues, then deals on from the seed", () => {
    const order = clueChallengeOrder(C, MAPS);
    expect(order.slice(0, 3)).toEqual([
      { id: "a", clue: "road" },
      { id: "b", clue: "climate" },
      { id: "c", clue: "continent" },
    ]);
    order.forEach((step, i) => expect(step.clue).toBe(clueAt(i)));
    expect(new Set(order.map((s) => s.id)).size).toBe(order.length);
    for (const step of order) expect(clueTruth(step.clue, step.id, MAPS)).not.toBeNull();
    expect(order.length).toBeGreaterThan(3);
  });

  it("is the same for everyone who opens the link", () => {
    const c = {
      ids: dealClueMix(BUNDLED, 11)
        .slice(0, 5)
        .map((s) => s.id),
      seed: 11,
    };
    const a = clueChallengeOrder({ ...c, streak: 5, miss: null }, BUNDLED);
    expect(a).toEqual(clueChallengeOrder({ ...c, streak: 5, miss: null }, BUNDLED));
    expect(a.length).toBeGreaterThan(20);
  });
});

describe("dealClueMix after named photos", () => {
  it("never deals them again and starts at the next clue in the cycle", () => {
    const rest = dealClueMix(BUNDLED, 3, ["x1", "x2"]);
    expect(rest[0].clue).toBe("continent");
    expect(rest[1].clue).toBe("road");
    const named = dealClueMix(BUNDLED, 3)
      .slice(0, 4)
      .map((s) => s.id);
    expect(dealClueMix(BUNDLED, 3, named).some((s) => named.includes(s.id))).toBe(false);
  });

  it("leaves a fresh deal as it was", () => {
    expect(dealClueMix(BUNDLED, 5, [])).toEqual(dealClueMix(BUNDLED, 5));
  });
});

describe("clueChallengeFrom", () => {
  const order = clueChallengeOrder(C, MAPS);
  it("names the steps up to the miss, with the wrong answer", () => {
    expect(clueChallengeFrom({ order, index: 1, seed: 7, streak: 1, miss: "Polar" })).toEqual({
      ids: ["a", "b"],
      seed: 7,
      streak: 1,
      miss: "Polar",
    });
  });

  it("drops the miss when the link can't show the step it was on", () => {
    const long = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, clue: clueAt(i) }));
    const c = clueChallengeFrom({ order: long, index: 70, seed: 1, streak: 70, miss: "left" });
    expect(c.ids).toHaveLength(CLUE_CHALLENGE_PHOTOS);
    expect(c.miss).toBeNull();
    expect(endsOnMiss(c)).toBe(false);
  });
});

describe("words", () => {
  const run = { order: clueChallengeOrder(C, MAPS), index: 3, seed: 7, streak: 3, miss: "left" };

  it("sends a link with counts only", () => {
    const text = clueChallengeText(run, HREF);
    expect(text).toContain("I read 3 clues in a row.");
    expect(text).toContain(
      `https://example.org/whereabout/clue-mix/?challenge=a.b.c.${run.order[3].id}_7_3_l`,
    );
    expect(text).not.toMatch(/Africa|Europe|Arid|Temperate/);
  });

  it("answers a challenge with how it went", () => {
    expect(clueChallengeText(run, HREF, C)).toContain("That beats your 2.");
    expect(clueChallengeLine(3, C)).toBe("You beat your friend's 2 in a row by 1.");
    expect(clueChallengeLine(0, C)).toBe("Your friend's 2 in a row wins, by 2.");
    expect(clueChallengeLine(2, C)).toBe("A dead heat: you both read 2 clues.");
  });

  it("shows the friend's answer on the step that ended their run only", () => {
    expect(friendMissAnswer(2, C)).toBe("Europe");
    expect(friendMissAnswer(1, C)).toBeNull();
    expect(friendMissAnswer(0, { ids: ["a"], seed: 1, streak: 0, miss: "right" })).toBe("Right");
    expect(friendMissAnswer(1, { ids: ["a", "b"], seed: 1, streak: 2, miss: null })).toBeNull();
  });
});

describe("clueHeadToHead", () => {
  it("lines both runs up clue by clue", () => {
    const run = { order: clueChallengeOrder(C, MAPS), index: 3, seed: 7, streak: 3, miss: "left" };
    const h = clueHeadToHead(run, C, HREF);
    expect(h.game).toBe("Clue mix");
    expect(h.outcome).toBe("won");
    expect(h.rows.map((r) => r.label)).toEqual(["Clue 1", "Clue 2", "Clue 3", "Clue 4"]);
    expect(h.rows.map((r) => [r.you, r.friend, r.winner])).toEqual([
      ["Right", "Right", "none"],
      ["Right", "Right", "none"],
      ["Right", "Wrong", "you"],
      ["Wrong", "—", "none"],
    ]);
    // The picture names no photo and no answer.
    const words = headToHeadLayout(h)
      .texts.map((t) => t.text)
      .join("\n");
    expect(words).not.toMatch(/Europe|Africa|challenge=/);
  });
});
