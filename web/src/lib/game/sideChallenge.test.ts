import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { bundledDrivingSides } from "./bundled";
import { leftRightOrder, type SideMap } from "./leftRight";
import {
  SIDE_CHALLENGE_PHOTOS,
  encodeSideChallenge,
  endsOnMiss,
  friendMissCall,
  isFriendMiss,
  parseSideChallenge,
  sideChallengeFrom,
  sideChallengeLine,
  sideChallengeOrder,
  sideChallengeText,
  sideChallengeUrl,
  sideHeadToHead,
  type SideChallenge,
} from "./sideChallenge";

const SIDES: SideMap = {
  a1: "left",
  b2: "right",
  c3: "right",
  d4: "left",
  e5: "right",
  f6: "right",
  g7: "left",
  h8: "right",
};
// Two photos called right (c3, a1), then a wrong call on f6.
const C: SideChallenge = { ids: ["c3", "a1", "f6"], seed: 4_000_000_000, streak: 2 };
const HREF = "https://example.org/whereabout/left-right/?x=1#top";

const sidesOf = (ids: string[]): SideMap => Object.fromEntries(ids.map((id) => [id, "right"]));

describe("Left or right? challenge links", () => {
  it("round-trip the photos, the seed and the streak", () => {
    const value = encodeSideChallenge(C);
    expect(value).toBe(`c3.a1.f6_${(4_000_000_000).toString(36)}_2`);
    expect(parseSideChallenge(value, SIDES)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseSideChallenge(encodeSideChallenge(c), SIDES)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("take a miss on the very first photo, and a run that called every photo it shows", () => {
    const first = { ids: ["b2"], seed: 7, streak: 0 };
    const every = { ids: ["b2", "a1"], seed: 7, streak: 2 };
    for (const c of [first, every]) {
      expect(parseSideChallenge(encodeSideChallenge(c), SIDES)).toEqual({
        ok: true,
        challenge: c,
      });
    }
    expect(endsOnMiss(first)).toBe(true);
    expect(endsOnMiss(every)).toBe(false);
  });

  it("turn away links that aren't a run Left or right? could have dealt", () => {
    for (const value of [
      "",
      "c3.a1.f6_1z",
      "c3.a1.f6_1z_1_9",
      "_1z_0",
      "c3.a1.c3_1z_2",
      "c3.a1.f6_1z_0",
      "c3.a1.f6_1z_1",
      "c3.a1.f6_1z_4",
      "c3.a1.f6_1z_-1",
      "c3.a1.f6_1z_1.5",
      "c3.a1.f6_ZZ_2",
      "c3.a1.f6__2",
      `c3.a1.f6_${(2 ** 32).toString(36)}_2`,
      "c3.a<1.f6_1z_2",
      "c3..f6_1z_1",
    ]) {
      expect(parseSideChallenge(value, SIDES), value).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("say so when a photo isn't dealt any more, without trusting inherited keys", () => {
    for (const value of ["c3.a1.zz9_1z_2", "c3.toString_1z_1", "constructor_1z_0"]) {
      expect(parseSideChallenge(value, SIDES), value).toEqual({ ok: false, reason: "missing" });
    }
  });

  it("cap the photos a link names, and let a full link carry a longer run", () => {
    const many = Array.from({ length: SIDE_CHALLENGE_PHOTOS + 1 }, (_, i) => `p${i}`);
    const full = many.slice(0, SIDE_CHALLENGE_PHOTOS).join(".");
    const parsed = parseSideChallenge(`${full}_1_${SIDE_CHALLENGE_PHOTOS + 40}`, sidesOf(many));
    expect(parsed).toMatchObject({ ok: true, challenge: { streak: SIDE_CHALLENGE_PHOTOS + 40 } });
    // A full link that ran past shows no miss.
    expect(parsed.ok && endsOnMiss(parsed.challenge)).toBe(false);
    expect(
      parseSideChallenge(`${many.join(".")}_1_${SIDE_CHALLENGE_PHOTOS}`, sidesOf(many)),
    ).toEqual({ ok: false, reason: "malformed" });
    // A shorter link can't claim a streak its photos never showed.
    expect(parseSideChallenge("a1.b2.c3_1_9", SIDES)).toEqual({ ok: false, reason: "malformed" });

    const made = sideChallengeFrom({ order: many, index: 70, seed: 1, streak: 70 });
    expect(made.ids).toEqual(many.slice(0, SIDE_CHALLENGE_PHOTOS));
    expect(made.streak).toBe(70);
    expect(endsOnMiss(made)).toBe(false);
  });

  it("deal the sender's photos first, then the rest evenly from both sides by the seed", () => {
    const order = sideChallengeOrder(C, SIDES);
    expect(order.slice(0, 3)).toEqual(C.ids);
    const rest = Object.fromEntries(Object.entries(SIDES).filter(([id]) => !C.ids.includes(id)));
    expect(order.slice(3)).toEqual(leftRightOrder(rest, C.seed));
    expect(new Set(order).size).toBe(order.length);
    expect(sideChallengeOrder(C, SIDES)).toEqual(order);
  });

  it("let a friend play on past the sender's miss on the bundled photos", () => {
    const sender = leftRightOrder(bundledDrivingSides, 12345);
    const c = sideChallengeFrom({ order: sender, index: 3, seed: 12345, streak: 3 });
    const order = sideChallengeOrder(c, bundledDrivingSides);
    expect(order.slice(0, 4)).toEqual(sender.slice(0, 4));
    expect(order.length).toBeGreaterThan(4);
    expect(new Set(order).size).toBe(order.length);
  });

  it("make a challenge from a finished run: the photos up to the one that ended it", () => {
    const run = { order: ["c3", "a1", "f6", "b2", "d4"], index: 2, seed: 99, streak: 2 };
    const c = sideChallengeFrom(run);
    expect(c).toEqual({ ids: ["c3", "a1", "f6"], seed: 99, streak: 2 });
    expect(endsOnMiss(c)).toBe(true);
    expect(isFriendMiss(2, c)).toBe(true);
    expect(isFriendMiss(1, c)).toBe(false);
    // A run that called every photo names them all, shows no miss, and reads back as it was.
    const cleared = sideChallengeFrom({ order: ["c3", "a1"], index: 1, seed: 9, streak: 2 });
    expect(cleared.ids).toEqual(["c3", "a1"]);
    expect(isFriendMiss(1, cleared)).toBe(false);
    expect(parseSideChallenge(encodeSideChallenge(cleared), SIDES)).toEqual({
      ok: true,
      challenge: cleared,
    });
  });

  it("give the side the friend called on the photo that ended their run, and nowhere else", () => {
    expect(friendMissCall(2, C, "right")).toBe("left");
    expect(friendMissCall(2, C, "left")).toBe("right");
    expect(friendMissCall(1, C, "left")).toBeNull();
    expect(friendMissCall(1, { ids: ["c3", "a1"], seed: 1, streak: 2 }, "left")).toBeNull();
  });

  it("keep only the challenge in the address", () => {
    expect(sideChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/left-right/?challenge=${encodeSideChallenge(C)}`,
    );
  });

  it("send a message that names no place or side, and answer a friend's run", () => {
    const run = { order: ["wm003", "wm004", "wm000"], index: 1, seed: 5, streak: 1 };
    const text = sideChallengeText(run, HREF);
    expect(text.split("\n")).toEqual([
      "Whereabout · Left or right?: I called 1 photo in a row.",
      "Same photos, same order: which side do they drive on?",
      "https://example.org/whereabout/left-right/?challenge=wm003.wm004_5_1",
    ]);
    for (const p of photos) {
      expect(text).not.toContain(p.place);
    }
    // The words name no side; the address is the page's own, /left-right/.
    const words = text
      .split("\n")
      .slice(0, 2)
      .join(" ")
      .toLowerCase()
      .replace("left or right?", "");
    expect(words).not.toMatch(/\b(left|right)\b/);
    expect(sideChallengeText(run, HREF, { ...C, streak: 0 })).toContain(
      "That beats your 0. Your turn to read the road.",
    );
    expect(sideChallengeText(run, HREF, C)).toContain("Your 2 wins this time. Try them again?");
    expect(sideChallengeText(run, HREF, { ...C, streak: 1 })).toContain("We tied.");
  });

  it("word how the run went against the friend's", () => {
    expect(sideChallengeLine(5, C)).toBe("You beat your friend's 2 in a row by 3.");
    expect(sideChallengeLine(1, C)).toBe("Your friend's 2 in a row wins, by 1.");
    expect(sideChallengeLine(2, C)).toBe("A dead heat: you both called 2 photos.");
  });
});

describe("the Left or right? head to head", () => {
  it("lists both runs photo by photo, to where each ended", () => {
    // A miss on the very first photo, against the friend's two right and a miss.
    const h = sideHeadToHead({ order: C.ids, index: 0, seed: 1, streak: 0 }, C, HREF);
    expect([h.game, h.youTotal, h.friendTotal, h.outcome]).toEqual([
      "Left or right?",
      "0 in a row",
      "2 in a row",
      "lost",
    ]);
    expect(h.rows.map((r) => [r.label, r.you, r.friend, r.winner])).toEqual([
      ["Photo 1", "Wrong", "Right", "friend"],
      ["Photo 2", "—", "Right", "friend"],
      ["Photo 3", "—", "Wrong", "none"],
    ]);
  });

  it("shows no miss for a run that called every photo, and draws no photo", () => {
    const h = sideHeadToHead({ order: C.ids, index: 2, seed: 1, streak: 3 }, C, HREF);
    expect(h.outcome).toBe("won");
    expect(h.rows.map((r) => [r.you, r.friend, r.winner])).toEqual([
      ["Right", "Right", "none"],
      ["Right", "Right", "none"],
      ["Right", "Wrong", "you"],
    ]);
    const words = headToHeadLayout(h)
      .texts.map((t) => t.text)
      .join("\n");
    for (const p of photos) {
      expect(words).not.toContain(p.id);
      expect(words).not.toContain(p.place);
    }
    expect(words).not.toContain("challenge=");
  });
});
