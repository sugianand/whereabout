import { describe, expect, it } from "vitest";

import { seededShuffle } from "./daily";
import {
  WAY_CHALLENGE_PHOTOS,
  encodeWayChallenge,
  friendMissPick,
  friendMissWords,
  parseWayChallenge,
  wayChallengeFrom,
  wayChallengeLine,
  wayChallengeOrder,
  wayChallengeText,
  wayChallengeUrl,
  type WayChallenge,
} from "./wayChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
// Two stops right (c3 to a1, a1 to f6), then a wrong pick, south-west, setting off from f6 to b2.
const C: WayChallenge = {
  ids: ["c3", "a1", "f6", "b2"],
  seed: 4_000_000_000,
  streak: 2,
  miss: "SW",
};
const HREF = "https://example.org/whereabout/which-way/?x=1#top";

describe("Which way? challenge links", () => {
  it("round-trip the photos, the seed, the streak and the wrong pick", () => {
    const value = encodeWayChallenge(C);
    expect(value).toBe(`c3.a1.f6.b2_${(4_000_000_000).toString(36)}_2_SW`);
    expect(parseWayChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseWayChallenge(encodeWayChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
    for (const miss of ["N", "NE", "E", "SE", "S", "W", "NW"] as const) {
      const c = { ...C, miss };
      expect(parseWayChallenge(encodeWayChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("take a miss on the first stop, and a run that travelled every stop it shows", () => {
    for (const c of [
      { ids: ["b2", "c3"], seed: 7, streak: 0, miss: "E" as const },
      { ids: ["b2", "c3", "d4"], seed: 7, streak: 2, miss: null },
    ]) {
      expect(parseWayChallenge(encodeWayChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
    expect(encodeWayChallenge({ ids: ["b2", "c3", "d4"], seed: 7, streak: 2, miss: null })).toBe(
      "b2.c3.d4_7_2",
    );
  });

  it("turn away links that aren't a run Which way? could have dealt", () => {
    for (const value of [
      "",
      "c3_1z_0",
      "c3.a1.f6_1z",
      "_1z_0_N",
      "c3.a1.c3_1z_1_N",
      "c3.a1.f6_1z_0", // a miss on stop 2 without its pick
      "c3.a1.f6_1z_2_N", // travelled every stop, yet a pick
      "c3.a1.f6_1z_1_X",
      "c3.a1.f6_1z_1_n",
      "c3.a1.f6_1z_1_",
      "c3.a1.f6_1z_1_N_N",
      "c3.a1.f6_1z_3",
      "c3.a1.f6_1Z_1_N",
      "c3.a1.f6_1z_-1_N",
      "c3.a1.f6_1z_x_N",
      `c3.a1.f6_${(2 ** 32).toString(36)}_1_N`,
      "c3.a1.f!6_1z_1_N",
      `${"x".repeat(33)}.a1_1z_0_N`,
    ]) {
      expect(parseWayChallenge(value, DEALABLE), value).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("say so when a photo isn't dealt any more", () => {
    expect(parseWayChallenge("c3.gone.f6_1z_1_N", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("name at most the cap, and take a full link's longer streak with no miss", () => {
    const ids = Array.from({ length: WAY_CHALLENGE_PHOTOS }, (_, i) => `p${i}`);
    const order = [...ids, "p60", "p61", "p62"];
    const c = wayChallengeFrom({ order, index: 61, seed: 3, streak: 61, miss: "N" });
    expect(c).toEqual({ ids, seed: 3, streak: 61, miss: null });
    expect(parseWayChallenge(encodeWayChallenge(c), order)).toEqual({ ok: true, challenge: c });
    expect(parseWayChallenge(`${[...ids, "p60"].join(".")}_3_59_N`, order)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("carry a run up to the stop that ended it, with the pick only on a miss", () => {
    const order = ["c3", "a1", "f6", "b2", "h8", "d4"];
    expect(wayChallengeFrom({ order, index: 2, seed: 9, streak: 2, miss: "SW" })).toEqual({
      ids: ["c3", "a1", "f6", "b2"],
      seed: 9,
      streak: 2,
      miss: "SW",
    });
    // A cleared run: its last stop set off from the second-last photo, and nothing was missed.
    expect(wayChallengeFrom({ order, index: 4, seed: 9, streak: 5, miss: null })).toEqual({
      ids: order,
      seed: 9,
      streak: 5,
      miss: null,
    });
  });

  it("deal the sender's photos first, then the rest of the deck from the seed", () => {
    const order = wayChallengeOrder(C, DEALABLE);
    expect(order.slice(0, 4)).toEqual(C.ids);
    expect(order.slice(4)).toEqual(seededShuffle(["d4", "e5", "g7", "h8"], C.seed));
    expect(new Set(order).size).toBe(DEALABLE.length);
  });

  it("put only the challenge in the page's address", () => {
    expect(wayChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/which-way/?challenge=${encodeWayChallenge(C)}`,
    );
  });

  it("word the run, and how it went against a friend's, naming no place", () => {
    const run = {
      order: ["c3", "a1", "f6", "b2", "h8"],
      index: 3,
      seed: 9,
      streak: 3,
      miss: "N" as const,
    };
    const sent = wayChallengeText(run, HREF);
    expect(sent.split("\n")).toEqual([
      "Whereabout · Which way?: I travelled 3 stops in a row.",
      "Same photos, same journey: can you find your way further?",
      "https://example.org/whereabout/which-way/?challenge=c3.a1.f6.b2.h8_9_3_N",
    ]);
    expect(wayChallengeText(run, HREF, C).split("\n")[1]).toBe(
      "That beats your 2. Your turn to travel further.",
    );
    expect(wayChallengeText({ ...run, streak: 1 }, HREF, C).split("\n")[0]).toBe(
      "Whereabout · Which way?: I travelled 1 stop in a row.",
    );
    expect(wayChallengeText({ ...run, streak: 1 }, HREF, C).split("\n")[1]).toBe(
      "Your 2 wins this time. Try the journey again?",
    );
    expect(wayChallengeText({ ...run, streak: 2 }, HREF, C).split("\n")[1]).toBe(
      "We tied. Travel it again to break it?",
    );
    expect(wayChallengeLine(5, C)).toBe("You beat your friend's 2 in a row by 3.");
    expect(wayChallengeLine(0, C)).toBe("Your friend's 2 in a row wins, by 2.");
    expect(wayChallengeLine(2, C)).toBe("A dead heat: you both travelled 2 stops.");
  });

  it("show the friend's pick only on the stop that ended their run, and only if it was wrong", () => {
    const order = wayChallengeOrder(C, DEALABLE);
    // The true heading from f6 to b2 is due north: south-west is wrong.
    expect(friendMissPick(order, 2, C, 0)).toBe("SW");
    expect(friendMissWords("SW")).toBe("Your friend's run ended here: they set off south-west.");
    expect(friendMissPick(order, 1, C, 0)).toBeNull();
    expect(friendMissPick(order, 3, C, 0)).toBeNull();
    // A hand-edited link whose pick would have been right shows nothing.
    expect(friendMissPick(order, 2, C, 225)).toBeNull();
    expect(friendMissPick(order, 2, C, 225 + 25)).toBeNull();
    // No miss in the link, or a journey that no longer runs through those two photos.
    expect(friendMissPick(order, 2, { ...C, streak: 3, miss: null }, 0)).toBeNull();
    expect(friendMissPick(["c3", "a1", "f6", "h8"], 2, C, 0)).toBeNull();
  });
});
