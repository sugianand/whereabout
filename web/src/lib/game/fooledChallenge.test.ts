import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { bundledById, bundledFooledIds } from "./bundled";
import { seededShuffle } from "./daily";
import { atlasMissKm, fooledReducer, initialFooled, type FooledState } from "./fooledAtlas";
import {
  FOOLED_CHALLENGE_PHOTOS,
  fooledChallengeFrom,
  fooledChallengeLine,
  fooledChallengeOrder,
  fooledChallengeText,
  fooledEndsOnMiss,
  fooledHeadToHead,
  friendMissPick,
  isFooledFriendMiss,
  parseFooledChallenge,
  type FooledChallenge,
  type FooledRun,
} from "./fooledChallenge";

const HREF = "https://example.org/whereabout/fooled-atlas/?x=1#top";
const miss = (id: string) => atlasMissKm(bundledById.get(id)!)!;

/** Plays the real photos in `order`, always picking the photo Atlas missed by more, until the
 * pair at `missAt`, where it picks the one Atlas missed by less: a run judged by the game itself. */
function playRun(order: readonly string[], missAt: number): FooledState {
  let s = fooledReducer(initialFooled, { type: "start", order });
  while (s.phase === "picking") {
    const [a, b] = [miss(s.order[s.index]), miss(s.order[s.index + 1])];
    const far = a >= b ? "a" : "b";
    const side = s.index === missAt ? friendMissPick(far) : far;
    s = fooledReducer(s, { type: "picked", side, missA: a, missB: b, sureA: 0.5, sureB: 0.4 });
    if (s.phase === "answered" && s.verdict.correct) s = fooledReducer(s, { type: "next" });
  }
  return s;
}

/** A run order where the pair at `at` is not a dead heat, so a wrong pick there can end it. */
function orderWithMissAt(at: number): string[] {
  for (let seed = 1; seed < 500; seed++) {
    const order = seededShuffle(bundledFooledIds, seed);
    const s = playRun(order, at);
    if (s.phase === "answered" && !s.verdict.correct) return order;
  }
  throw new Error("no order with a callable pair");
}

describe("Which fooled Atlas? challenge links", () => {
  it("make a link from a real run that ended on a miss, and read it back", () => {
    const order = orderWithMissAt(2);
    const s = playRun(order, 2);
    if (s.phase !== "answered") throw new Error("run did not end on a miss");
    expect(s.streak).toBe(2);
    const run: FooledRun = { ...s, seed: 1234 };
    const c = fooledChallengeFrom(run);
    expect(c).toEqual({ ids: order.slice(0, 4), seed: 1234, streak: 2 });
    expect(fooledEndsOnMiss(c)).toBe(true);
    expect(isFooledFriendMiss(2, c)).toBe(true);
    expect(isFooledFriendMiss(1, c)).toBe(false);

    const value = new URL(fooledChallengeText(run, HREF).split("\n").at(-1)!).searchParams.get(
      "challenge",
    )!;
    expect(parseFooledChallenge(value, bundledFooledIds)).toEqual({ ok: true, challenge: c });

    // The friend's pick on the pair that ended the run is the photo Atlas missed by less.
    const [a, b] = [miss(c.ids[2]), miss(c.ids[3])];
    expect(friendMissPick(s.verdict.fooled)).toBe(a < b ? "a" : "b");
  });

  it("deal the sender's photos first, then the rest Atlas pinned, shuffled by the seed", () => {
    const c: FooledChallenge = { ids: bundledFooledIds.slice(0, 3), seed: 77, streak: 1 };
    const order = fooledChallengeOrder(c, bundledFooledIds);
    expect(order.slice(0, 3)).toEqual(c.ids);
    expect(order.slice(3)).toEqual(seededShuffle(bundledFooledIds.slice(3), 77));
    expect(new Set(order)).toEqual(new Set(bundledFooledIds));
  });

  it("turn away links whose photos Atlas didn't pin, or that can't be a run", () => {
    const pinned = new Set(bundledFooledIds);
    const unpinned = photos.map((p) => p.id).find((id) => !pinned.has(id));
    const [p, q, r] = bundledFooledIds;
    if (unpinned) {
      expect(parseFooledChallenge(`${p}.${unpinned}_1_0`, bundledFooledIds)).toEqual({
        ok: false,
        reason: "missing",
      });
    }
    for (const value of ["", `${p}_1_0`, `${p}.${q}.${r}_1_5`, `${p}.${p}_1_0`]) {
      expect(parseFooledChallenge(value, bundledFooledIds), value).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("cap the photos a long run names, with no miss to show", () => {
    const many = Array.from({ length: FOOLED_CHALLENGE_PHOTOS + 10 }, (_, i) => `p${i}`);
    const c = fooledChallengeFrom({
      order: many,
      index: 65,
      seed: 3,
      streak: 65,
      atlasRight: 30,
      atlasPlayed: 60,
    });
    expect(c.ids).toHaveLength(FOOLED_CHALLENGE_PHOTOS);
    expect(fooledEndsOnMiss(c)).toBe(false);
  });

  it("send a message with Atlas's tally that names no place, and answer a friend's run", () => {
    const [p, q, r] = bundledFooledIds;
    const run: FooledRun = {
      order: [p, q, r],
      index: 1,
      seed: 5,
      streak: 1,
      atlasRight: 1,
      atlasPlayed: 2,
    };
    const text = fooledChallengeText(run, HREF);
    expect(text.split("\n")).toEqual([
      "Whereabout · Which fooled Atlas?: I called 1 pair in a row. Atlas's own pick: 1 of 2 pairs.",
      "Same photos, same order: can you tell where Atlas got lost?",
      `https://example.org/whereabout/fooled-atlas/?challenge=${p}.${q}.${r}_5_1`,
    ]);
    for (const photo of photos) expect(text).not.toContain(photo.place);
    expect(fooledChallengeText({ ...run, atlasPlayed: 0 }, HREF).split("\n")[0]).toBe(
      "Whereabout · Which fooled Atlas?: I called 1 pair in a row.",
    );

    const c: FooledChallenge = { ids: [p, q, r], seed: 5, streak: 2 };
    expect(fooledChallengeText(run, HREF, { ...c, streak: 0 })).toContain(
      "That beats your 0. Your turn to read Atlas's misses.",
    );
    expect(fooledChallengeText(run, HREF, c)).toContain("Your 2 wins this time.");
    expect(fooledChallengeText(run, HREF, { ...c, streak: 1 })).toContain("We tied.");
  });

  it("word how the run went against the friend's", () => {
    const c: FooledChallenge = { ids: ["a", "b", "c", "d"], seed: 1, streak: 2 };
    expect(fooledChallengeLine(5, c)).toBe("You beat your friend's 2 in a row by 3.");
    expect(fooledChallengeLine(1, c)).toBe("Your friend's 2 in a row wins, by 1.");
    expect(fooledChallengeLine(2, c)).toBe("A dead heat: you both called 2 pairs.");
  });
});

describe("the Which fooled Atlas? head to head", () => {
  it("lists both runs pair by pair and draws no photo, place or link", () => {
    const c: FooledChallenge = { ids: bundledFooledIds.slice(0, 4), seed: 1, streak: 2 };
    const run: FooledRun = {
      order: c.ids,
      index: 0,
      seed: 1,
      streak: 0,
      atlasRight: 0,
      atlasPlayed: 1,
    };
    const h = fooledHeadToHead(run, c, HREF);
    expect([h.game, h.youTotal, h.friendTotal, h.outcome]).toEqual([
      "Which fooled Atlas?",
      "0 in a row",
      "2 in a row",
      "lost",
    ]);
    expect(h.rows.map((row) => [row.label, row.you, row.friend, row.winner])).toEqual([
      ["Pair 1", "Wrong", "Right", "friend"],
      ["Pair 2", "—", "Right", "friend"],
      ["Pair 3", "—", "Wrong", "none"],
    ]);
    const words = headToHeadLayout(h)
      .texts.map((t) => t.text)
      .join("\n");
    for (const photo of photos) {
      expect(words).not.toContain(photo.id);
      expect(words).not.toContain(photo.place);
    }
    expect(words).not.toContain("challenge=");
  });
});
