import { describe, expect, it } from "vitest";

import {
  ODD_CHALLENGE_QUADS,
  encodeOddChallenge,
  oddChallengeDealer,
  oddChallengeFrom,
  oddChallengeLine,
  oddChallengeText,
  oddChallengeUrl,
  oddFriendMissLine,
  parseOddChallenge,
  quadOf,
  type OddChallenge,
} from "./oddChallenge";
import type { Quad } from "./oddOneOut";
import type { Regions } from "./regions";

const REGIONS: Regions = {
  Asia: ["j1", "j2", "j3", "j4", "j5", "j6", "j7"],
  Europe: ["e1", "e2", "e3", "e4", "e5"],
  Africa: ["a1", "a2", "a3", "a4", "a5"],
};

const Q1: Quad = { ids: ["j1", "e1", "j2", "j3"], odd: 1, common: "Asia", oddContinent: "Europe" };
const Q2: Quad = {
  ids: ["e2", "e3", "e4", "a1"],
  odd: 3,
  common: "Europe",
  oddContinent: "Africa",
};
// The sender got Q1 right and tapped photo 1 on Q2.
const C: OddChallenge = { quads: [Q1, Q2], streak: 1, missPick: 0 };
const HREF = "https://example.org/whereabout/odd-one-out/?x=1#top";

describe("odd one out challenge links", () => {
  it("round-trip the quads, as laid out, with the streak and the miss", () => {
    const value = encodeOddChallenge(C);
    expect(value).toBe("j1.e1.j2.j3-e2.e3.e4.a1_1_1");
    expect(parseOddChallenge(value, REGIONS)).toEqual({ ok: true, challenge: C });
  });

  it("read which photo is odd from the catalog, not from the link", () => {
    const continents = new Map(
      Object.entries(REGIONS).flatMap(([c, ids]) => ids.map((id) => [id, c] as const)),
    ) as Map<string, "Asia" | "Europe" | "Africa">;
    expect(quadOf(["e1", "j1", "j2", "j3"], continents)).toMatchObject({
      odd: 0,
      common: "Asia",
      oddContinent: "Europe",
    });
    // Two and two, all four alike, or three continents: not a quad.
    expect(quadOf(["e1", "e2", "j1", "j2"], continents)).toBeNull();
    expect(quadOf(["e1", "e2", "e3", "e4"], continents)).toBeNull();
    expect(quadOf(["e1", "e2", "j1", "a1"], continents)).toBeNull();
    expect(quadOf(["e1", "j1", "j2", "gone"], continents)).toBeNull();
  });

  it("take a full link that stops before the miss", () => {
    const quads = Array.from({ length: ODD_CHALLENGE_QUADS }, () => Q1);
    const full: OddChallenge = { quads, streak: 22, missPick: null };
    const value = encodeOddChallenge(full);
    expect(value.endsWith("_22_0")).toBe(true);
    expect(parseOddChallenge(value, REGIONS)).toEqual({ ok: true, challenge: full });
    // A full link with streak to match its quads stops right at the miss it doesn't carry.
    expect(parseOddChallenge(encodeOddChallenge({ ...full, streak: 15 }), REGIONS)).toEqual({
      ok: true,
      challenge: { ...full, streak: 15 },
    });
  });

  it("turn away links a run could not give", () => {
    for (const value of [
      "",
      "j1.e1.j2.j3_0",
      "j1.e1.j2.j3_0_1_9",
      // Three photos, a photo twice, a bad id.
      "j1.e1.j2_0_1",
      "j1.e1.j1.j3_0_2",
      "j1.e1.j2.j$_0_1",
      // The streak must be one short of the quads...
      "j1.e1.j2.j3-e2.e3.e4.a1_2_1",
      "j1.e1.j2.j3-e2.e3.e4.a1_0_1",
      // ...with a wrong tap named on the last one, never the odd photo, and no 0 short of full.
      "j1.e1.j2.j3-e2.e3.e4.a1_1_0",
      "j1.e1.j2.j3-e2.e3.e4.a1_1_4",
      "j1.e1.j2.j3-e2.e3.e4.a1_1_5",
      // Four photos that aren't three and one.
      "j1.e1.j2.e2_0_1",
      // Too many quads.
      `${Array.from({ length: ODD_CHALLENGE_QUADS + 1 }, () => "j1.e1.j2.j3").join("-")}_16_0`,
    ]) {
      expect(parseOddChallenge(value, REGIONS), value).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("say when a photo isn't dealt any more", () => {
    expect(parseOddChallenge("j1.e1.j2.gone_0_1", REGIONS)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("deal the friend the linked quads first, then fresh ones from unseen photos", () => {
    const dealer = oddChallengeDealer(C, REGIONS, () => 0);
    expect(dealer.next()).toEqual(Q1);
    expect(dealer.next()).toEqual(Q2);
    const fresh = dealer.next()!;
    const shown = new Set([...Q1.ids, ...Q2.ids]);
    expect(fresh.ids.filter((id) => shown.has(id))).toEqual([]);
    const after = oddChallengeDealer(C, REGIONS, () => 0);
    after.skip(2);
    expect(after.next()).toEqual(fresh);
  });

  it("are made from a finished run, capped at a sendable length", () => {
    expect(oddChallengeFrom({ quads: [Q1, Q2], streak: 1, picked: 0 })).toEqual(C);
    const long = Array.from({ length: ODD_CHALLENGE_QUADS + 3 }, () => Q1);
    const capped = oddChallengeFrom({ quads: long, streak: ODD_CHALLENGE_QUADS + 2, picked: 0 });
    expect(capped.quads).toHaveLength(ODD_CHALLENGE_QUADS);
    expect(capped.missPick).toBeNull();
    expect(parseOddChallenge(encodeOddChallenge(capped), REGIONS)).toEqual({
      ok: true,
      challenge: capped,
    });
  });

  it("keep only the challenge in the address", () => {
    expect(oddChallengeUrl(HREF, C)).toBe(
      "https://example.org/whereabout/odd-one-out/?challenge=j1.e1.j2.j3-e2.e3.e4.a1_1_1",
    );
  });
});

describe("odd one out challenge words", () => {
  const run = { quads: [Q1, Q2], streak: 1, picked: 0 };

  it("send the run and the link, and answer a friend's", () => {
    expect(oddChallengeText(run, HREF).split("\n")).toEqual([
      "Whereabout · Odd one out: I spotted the odd one in 1 quad in a row.",
      "Same photos, same places: can you go further?",
      "https://example.org/whereabout/odd-one-out/?challenge=j1.e1.j2.j3-e2.e3.e4.a1_1_1",
    ]);
    expect(oddChallengeText(run, HREF, { ...C, streak: 0 }).split("\n")[1]).toBe(
      "That beats your 0. Your turn to go further.",
    );
    expect(oddChallengeText(run, HREF, { ...C, streak: 3 }).split("\n")[1]).toBe(
      "Your 3 wins this time. Try them again?",
    );
    expect(oddChallengeText(run, HREF, C).split("\n")[1]).toBe(
      "We tied. Play them again to break it?",
    );
  });

  it("say who won, and by how many", () => {
    expect(oddChallengeLine(4, C)).toBe("You beat your friend's 1 in a row by 3.");
    expect(oddChallengeLine(0, C)).toBe("Your friend's 1 in a row wins, by 1.");
    expect(oddChallengeLine(1, C)).toBe("A dead heat: you both spotted 1 quad.");
  });

  it("show the friend's wrong tap on the quad that ended their run only", () => {
    expect(oddFriendMissLine(0, C)).toBeNull();
    expect(oddFriendMissLine(1, C)).toBe("Your friend's run ended here: they picked photo 1.");
    expect(oddFriendMissLine(2, C)).toBeNull();
    expect(oddFriendMissLine(1, { ...C, missPick: null })).toBeNull();
  });
});
