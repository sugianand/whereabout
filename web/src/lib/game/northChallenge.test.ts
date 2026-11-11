import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";

import { seededShuffle } from "./daily";
import {
  NORTH_CHALLENGE_PHOTOS,
  encodeNorthChallenge,
  endsOnMiss,
  isFriendMiss,
  northChallengeFrom,
  northChallengeLine,
  northChallengeOrder,
  northChallengeText,
  northChallengeUrl,
  parseNorthChallenge,
  type NorthChallenge,
} from "./northChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
// Two pairs right (c3/a1, a1/f6), then a wrong pick on f6/b2.
const C: NorthChallenge = { ids: ["c3", "a1", "f6", "b2"], seed: 4_000_000_000, streak: 2 };
const HREF = "https://example.org/whereabout/further-north/?x=1#top";

describe("Further North challenge links", () => {
  it("round-trip the photos, the seed and the streak", () => {
    const value = encodeNorthChallenge(C);
    expect(value).toBe(`c3.a1.f6.b2_${(4_000_000_000).toString(36)}_2`);
    expect(parseNorthChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseNorthChallenge(encodeNorthChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("take a miss on the first pair, and a run that called every pair it shows", () => {
    for (const c of [
      { ids: ["b2", "c3"], seed: 7, streak: 0 },
      { ids: ["b2", "c3", "d4"], seed: 7, streak: 2 },
    ]) {
      expect(parseNorthChallenge(encodeNorthChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
    expect(endsOnMiss({ ids: ["b2", "c3"], seed: 7, streak: 0 })).toBe(true);
    expect(endsOnMiss({ ids: ["b2", "c3", "d4"], seed: 7, streak: 2 })).toBe(false);
  });

  it("turn away links that aren't a run Further North could have dealt", () => {
    for (const value of [
      "",
      "c3_1z_0",
      "c3.a1.f6_1z",
      "c3.a1.f6_1z_1_9",
      "_1z_0",
      "c3.a1.c3_1z_1",
      "c3.a1.f6.b2_1z_0",
      "c3.a1.f6.b2_1z_4",
      "c3.a1.f6_1z_-1",
      "c3.a1.f6_1z_1.5",
      "c3.a1.f6_ZZ_1",
      "c3.a1.f6__1",
      `c3.a1.f6_${(2 ** 32).toString(36)}_1`,
      "c3.a<1.f6_1z_1",
    ]) {
      expect(parseNorthChallenge(value, DEALABLE), value).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("cap the photos a link names, and let a full link carry a longer run", () => {
    const many = Array.from({ length: NORTH_CHALLENGE_PHOTOS + 1 }, (_, i) => `p${i}`);
    const full = many.slice(0, NORTH_CHALLENGE_PHOTOS).join(".");
    const parsed = parseNorthChallenge(`${full}_1_${NORTH_CHALLENGE_PHOTOS + 40}`, many);
    expect(parsed).toMatchObject({ ok: true, challenge: { streak: NORTH_CHALLENGE_PHOTOS + 40 } });
    // A full link that ran past shows no miss.
    expect(parsed.ok && endsOnMiss(parsed.challenge)).toBe(false);
    expect(parseNorthChallenge(`${many.join(".")}_1_${NORTH_CHALLENGE_PHOTOS}`, many)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // A shorter link can't claim a streak its photos never showed.
    expect(parseNorthChallenge("a1.b2.c3_1_9", DEALABLE)).toEqual({
      ok: false,
      reason: "malformed",
    });

    const made = northChallengeFrom({ order: many, index: 70, seed: 1, streak: 70 });
    expect(made.ids).toEqual(many.slice(0, NORTH_CHALLENGE_PHOTOS));
    expect(made.streak).toBe(70);
    expect(endsOnMiss(made)).toBe(false);
  });

  it("say so when a photo isn't dealt any more", () => {
    expect(parseNorthChallenge("c3.a1.zz9_1z_1", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("deal the sender's photos first, then the rest of the deck shuffled by the seed", () => {
    const order = northChallengeOrder(C, DEALABLE);
    expect(order.slice(0, 4)).toEqual(C.ids);
    const rest = DEALABLE.filter((id) => !C.ids.includes(id));
    expect(order.slice(4)).toEqual(seededShuffle(rest, C.seed));
    expect(new Set(order).size).toBe(DEALABLE.length);
    expect(northChallengeOrder(C, DEALABLE)).toEqual(order);
  });

  it("make a challenge from a finished run: the photos up to the pair that ended it", () => {
    const run = { order: ["c3", "a1", "f6", "b2", "d4"], index: 2, seed: 99, streak: 2 };
    const c = northChallengeFrom(run);
    expect(c).toEqual({ ids: ["c3", "a1", "f6", "b2"], seed: 99, streak: 2 });
    expect(endsOnMiss(c)).toBe(true);
    expect(isFriendMiss(2, c)).toBe(true);
    expect(isFriendMiss(1, c)).toBe(false);
    // A run that called every pair names every photo, shows no miss, and reads back as it was.
    const cleared = northChallengeFrom({ order: ["c3", "a1", "f6"], index: 1, seed: 9, streak: 2 });
    expect(cleared.ids).toEqual(["c3", "a1", "f6"]);
    expect(isFriendMiss(1, cleared)).toBe(false);
    expect(parseNorthChallenge(encodeNorthChallenge(cleared), DEALABLE)).toEqual({
      ok: true,
      challenge: cleared,
    });
  });

  it("keep only the challenge in the address", () => {
    expect(northChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/further-north/?challenge=${encodeNorthChallenge(C)}`,
    );
  });

  it("send a message that names no place, and answer a friend's run", () => {
    const run = { order: ["wm003", "wm004", "wm000"], index: 1, seed: 5, streak: 1 };
    const text = northChallengeText(run, HREF);
    expect(text.split("\n")).toEqual([
      "Whereabout · Further North: I called 1 pair in a row.",
      "Same photos, same order: can you go further north?",
      "https://example.org/whereabout/further-north/?challenge=wm003.wm004.wm000_5_1",
    ]);
    for (const p of photos) {
      expect(text).not.toContain(p.place);
    }
    expect(northChallengeText(run, HREF, { ...C, streak: 0 })).toContain(
      "That beats your 0. Your turn to go further.",
    );
    expect(northChallengeText(run, HREF, C)).toContain("Your 2 wins this time. Try them again?");
    expect(northChallengeText(run, HREF, { ...C, streak: 1 })).toContain("We tied.");
  });

  it("word how the run went against the friend's", () => {
    expect(northChallengeLine(5, C)).toBe("You beat your friend's 2 in a row by 3.");
    expect(northChallengeLine(1, C)).toBe("Your friend's 2 in a row wins, by 1.");
    expect(northChallengeLine(2, C)).toBe("A dead heat: you both called 2 pairs.");
  });
});
