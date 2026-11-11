import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";
import { countryName } from "@/lib/countries";
import { headToHeadLayout } from "@/lib/headToHead";

import { seededShuffle } from "./daily";
import {
  NAME_CHALLENGE_PHOTOS,
  encodeNameChallenge,
  nameChallengeFrom,
  nameChallengeLine,
  nameChallengeOrder,
  nameChallengeText,
  nameChallengeUrl,
  nameHeadToHead,
  parseNameChallenge,
  type NameChallenge,
} from "./nameChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
const C: NameChallenge = { ids: ["c3", "a1", "f6"], seed: 4_000_000_000, streak: 2 };
const HREF = "https://example.org/whereabout/name-country/?x=1#top";

describe("name the country challenge links", () => {
  it("round-trip the photos, the seed and the streak", () => {
    const value = encodeNameChallenge(C);
    expect(value).toBe(`c3.a1.f6_${(4_000_000_000).toString(36)}_2`);
    expect(parseNameChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseNameChallenge(encodeNameChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("take a miss on the first photo, and a run that named every photo it shows", () => {
    for (const c of [
      { ids: ["b2"], seed: 7, streak: 0 },
      { ids: ["b2", "c3"], seed: 7, streak: 2 },
    ]) {
      expect(parseNameChallenge(encodeNameChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("turn away links that aren't a run Name the country could have dealt", () => {
    for (const value of [
      "",
      "c3.a1.f6_1z",
      "c3.a1.f6_1z_2_9",
      "_1z_0",
      "c3.a1.c3_1z_2",
      "c3.a1.f6_1z_1",
      "c3.a1.f6_1z_4",
      "c3.a1.f6_1z_-2",
      "c3.a1.f6_1z_2.5",
      "c3.a1.f6_ZZ_2",
      "c3.a1.f6__2",
      `c3.a1.f6_${(2 ** 32).toString(36)}_2`,
      "c3.a<1.f6_1z_2",
    ]) {
      expect(parseNameChallenge(value, DEALABLE), value).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("caps the photos a link names, and lets a full link carry a longer run", () => {
    const many = Array.from({ length: NAME_CHALLENGE_PHOTOS + 1 }, (_, i) => `p${i}`);
    const full = many.slice(0, NAME_CHALLENGE_PHOTOS).join(".");
    expect(parseNameChallenge(`${full}_1_${NAME_CHALLENGE_PHOTOS + 40}`, many)).toMatchObject({
      ok: true,
      challenge: { streak: NAME_CHALLENGE_PHOTOS + 40 },
    });
    expect(parseNameChallenge(`${many.join(".")}_1_${NAME_CHALLENGE_PHOTOS}`, many)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // A shorter link can't claim a streak its photos never showed.
    expect(parseNameChallenge("a1.b2_1_9", DEALABLE)).toEqual({ ok: false, reason: "malformed" });

    const order = many;
    const made = nameChallengeFrom({ order, index: 70, seed: 1, streak: 70 });
    expect(made.ids).toEqual(many.slice(0, NAME_CHALLENGE_PHOTOS));
    expect(made.streak).toBe(70);
  });

  it("say so when a photo isn't dealt any more", () => {
    expect(parseNameChallenge("c3.a1.zz9_1z_2", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("deal the sender's photos first, then the rest of the deck shuffled by the seed", () => {
    const order = nameChallengeOrder(C, DEALABLE);
    expect(order.slice(0, 3)).toEqual(C.ids);
    const rest = DEALABLE.filter((id) => !C.ids.includes(id));
    expect(order.slice(3)).toEqual(seededShuffle(rest, C.seed));
    expect(new Set(order).size).toBe(DEALABLE.length);
    // The same link deals the same run every time.
    expect(nameChallengeOrder(C, DEALABLE)).toEqual(order);
  });

  it("make a challenge from a finished run: the photos up to the miss", () => {
    const run = { order: ["c3", "a1", "f6", "b2", "d4"], index: 2, seed: 99, streak: 2 };
    expect(nameChallengeFrom(run)).toEqual({ ids: ["c3", "a1", "f6"], seed: 99, streak: 2 });
    // A run that named every photo names them all, and reads back as it was.
    const cleared = { order: ["c3", "a1"], index: 1, seed: 99, streak: 2 };
    const c = nameChallengeFrom(cleared);
    expect(c.ids).toEqual(["c3", "a1"]);
    expect(parseNameChallenge(encodeNameChallenge(c), DEALABLE)).toEqual({
      ok: true,
      challenge: c,
    });
  });

  it("keep only the challenge in the address", () => {
    expect(nameChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/name-country/?challenge=${encodeNameChallenge(C)}`,
    );
  });

  it("send a message that names no place, and answers a friend's streak", () => {
    const run = { order: ["wm003", "wm004", "wm000"], index: 2, seed: 5, streak: 2 };
    const text = nameChallengeText(run, HREF);
    expect(text.split("\n")).toEqual([
      "Whereabout · Name the country: I named 2 countries in a row.",
      "Same photos, same names: can you go further?",
      `https://example.org/whereabout/name-country/?challenge=wm003.wm004.wm000_5_2`,
    ]);
    for (const p of photos) {
      expect(text).not.toContain(p.place);
    }
    const one = { ...run, index: 0, streak: 0 };
    expect(nameChallengeText(one, HREF)).toContain("I named 0 countries in a row.");
    expect(nameChallengeText({ ...run, streak: 1, index: 1 }, HREF)).toContain(
      "I named 1 country in a row.",
    );

    const friend = { ids: ["wm003"], seed: 5, streak: 1 };
    expect(nameChallengeText(run, HREF, friend)).toContain(
      "That beats your 1. Your turn to go further.",
    );
    expect(
      nameChallengeText(run, HREF, { ...friend, streak: 4, ids: ["a", "b", "c", "d"] }),
    ).toContain("Your 4 wins this time. Try them again?");
    expect(nameChallengeText(run, HREF, { ...friend, streak: 2 })).toContain("We tied.");
  });

  it("tell the friend who won and by how much", () => {
    expect(nameChallengeLine(5, C)).toBe("You beat your friend's 2 in a row by 3.");
    expect(nameChallengeLine(1, C)).toBe("Your friend's 2 in a row wins, by 1.");
    expect(nameChallengeLine(2, C)).toBe("A dead heat: you both named 2 countries.");
  });
});

describe("the Name the country head to head", () => {
  it("lists both runs photo by photo, a shared miss ringed for both", () => {
    // Two right and a miss on photo 3, as the friend did: a dead heat.
    const h = nameHeadToHead({ index: 2, streak: 2 }, C, HREF);
    expect([h.game, h.youTotal, h.friendTotal, h.outcome]).toEqual([
      "Name the country",
      "2 in a row",
      "2 in a row",
      "tied",
    ]);
    expect(h.rows.map((r) => [r.label, r.you, r.friend, r.winner])).toEqual([
      ["Photo 1", "Right", "Right", "none"],
      ["Photo 2", "Right", "Right", "none"],
      ["Photo 3", "Wrong", "Wrong", "tie"],
    ]);
  });

  it("shows no miss for a run that named every photo, and draws no photo or country", () => {
    const cleared = { index: 2, streak: 3 };
    const c: NameChallenge = { ...C, streak: 3 };
    const h = nameHeadToHead(cleared, c, HREF);
    expect(h.rows.map((r) => [r.you, r.friend, r.winner])).toEqual([
      ["Right", "Right", "none"],
      ["Right", "Right", "none"],
      ["Right", "Right", "none"],
    ]);
    const words = headToHeadLayout(nameHeadToHead({ index: 0, streak: 0 }, C, HREF))
      .texts.map((t) => t.text)
      .join("\n");
    expect(words).toContain("Your friend won");
    for (const p of photos) {
      expect(words).not.toContain(p.id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(countryName(p.country));
    }
    expect(words).not.toContain("challenge=");
  });
});
