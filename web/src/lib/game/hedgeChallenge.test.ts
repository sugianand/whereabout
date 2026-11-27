import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";
import { countryName } from "@/lib/countries";

import { bundledById, bundledHedgeIds } from "./bundled";
import type { GameRecord } from "./deck";
import { dealHedge, hedgeOptions, hedgeResult, type HedgeResult } from "./hedge";
import {
  encodeHedgeChallenge,
  hedgeChallengeFrom,
  hedgeChallengeLine,
  hedgeChallengeOutcome,
  hedgeChallengeScore,
  hedgeChallengeText,
  hedgeChallengeUrl,
  hedgeFriendLine,
  hedgeFriendResult,
  hedgeFriendResults,
  hedgeHeadToHead,
  parseHedgeChallenge,
  type HedgeChallenge,
} from "./hedgeChallenge";

const IDS = ["a1", "b2", "c3", "d4", "e5"];
const DEALT = [...IDS, "f6", "g7"];
const SEED = 123456789;
const HREF = "https://example.org/whereabout/hedge/?challenge=old#x";

/** Every photo is in France; Atlas weighs France, Germany, Italy and Spain. */
function record(id: string): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country: "FR",
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: {
      lng: 0,
      lat: 0,
      confidence: 0.6,
      topCountries: [
        { country: "FR", p: 0.6 },
        { country: "DE", p: 0.2 },
        { country: "IT", p: 0.1 },
        { country: "ES", p: 0.1 },
      ],
      clues: [],
    },
  };
}
const RECORDS = new Map(IDS.map((id) => [id, record(id)]));
const options = (id: string) => hedgeOptions(RECORDS.get(id)!, SEED);

/** A bet with `n` chips on France and the rest on the first other country. */
function bet(id: string, n: number): number[] {
  const opts = options(id);
  const right = opts.indexOf("FR");
  const other = right === 0 ? 1 : 0;
  return opts.map((_, i) => (i === right ? n : i === other ? 10 - n : 0));
}
const play = (onRight: number[]): HedgeResult[] =>
  IDS.map((id, i) => hedgeResult(RECORDS.get(id)!, options(id), bet(id, onRight[i]!))!);

// The sender put 5 chips on France on every photo: 750 points each.
const C: HedgeChallenge = { seed: SEED, ids: IDS, bets: IDS.map((id) => bet(id, 5)) };

describe("the challenge link", () => {
  it("round-trips through the address, one character a country", () => {
    const c: HedgeChallenge = {
      seed: SEED,
      ids: IDS,
      bets: [
        [10, 0, 0, 0],
        [3, 3, 3, 1],
        [0, 0, 0, 10],
        [5, 5],
        [1, 2, 3, 4],
      ],
    };
    const value = encodeHedgeChallenge(c);
    expect(value).toBe("21i3v9_a1.b2.c3.d4.e5_a000.3331.000a.55.1234");
    expect(parseHedgeChallenge(value, DEALT)).toEqual({ ok: true, challenge: c });
  });

  it("carries the largest 32-bit seed", () => {
    const c = { ...C, seed: 0xffffffff };
    const value = encodeHedgeChallenge(c);
    expect(value.split("_")[0]).toBe("1z141z3");
    expect(parseHedgeChallenge(value, DEALT)).toEqual({ ok: true, challenge: c });
  });

  it("is made from a whole game, its seed, photos and chips", () => {
    const game = play([10, 5, 0, 3, 7]);
    expect(hedgeChallengeFrom(SEED, game)).toEqual({
      seed: SEED,
      ids: IDS,
      bets: game.map((r) => r.chips),
    });
  });

  it("keeps only the challenge in the page's address", () => {
    expect(hedgeChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/hedge/?challenge=${encodeHedgeChallenge(C)}`,
    );
  });

  const five = IDS.join(".");
  const bets = "a000.a000.a000.a000.a000";
  it.each([
    ["", "nothing"],
    [`21i3v9_${five}`, "no bets"],
    [`${five}_${bets}`, "no seed"],
    [`21i3v9_${IDS.slice(0, 4).join(".")}_a000.a000.a000.a000`, "four photos"],
    [`21i3v9_${five}.f6_${bets}.a000`, "six photos"],
    [`21i3v9_${five}_a000.a000.a000.a000`, "a bet short"],
    [`21i3v9_${five}_a000.a000.a000.a000.9000`, "nine chips"],
    [`21i3v9_${five}_a000.a000.a000.a000.a100`, "eleven chips"],
    [`21i3v9_${five}_a000.a000.a000.a000.a`, "one country"],
    [`21i3v9_${five}_a000.a000.a000.a000.a0000`, "five countries"],
    [`21i3v9_${five}_a000.a000.a000.a000.b000`, "a chip count that isn't one"],
    [`21i3v9_${five}_A000.a000.a000.a000.a000`, "a shouted ten"],
    [`1z141z4_${five}_${bets}`, "a seed past 32 bits"],
    [`zzzzzzzz_${five}_${bets}`, "a seed too long"],
    [`21I3V9_${five}_${bets}`, "a shouted seed"],
    [`21i3v9_a1.a1.c3.d4.e5_${bets}`, "a photo twice"],
    [`21i3v9_a1.b2.c3.d4.e/5_${bets}`, "a photo id that isn't one"],
    [`21i3v9_${five}_${bets}_x`, "a fourth part"],
  ])("sets aside %j (%s) as malformed", (value) => {
    expect(parseHedgeChallenge(value, DEALT)).toEqual({ ok: false, reason: "malformed" });
  });

  it("says when a photo isn't dealt any more", () => {
    expect(parseHedgeChallenge(`21i3v9_a1.b2.c3.d4.zz_${bets}`, DEALT)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("takes a challenge over the photos and countries the real game deals", () => {
    const seed = 42;
    const ids = dealHedge(bundledHedgeIds, seed);
    expect(ids).toHaveLength(5);
    const game = ids.map((id) => {
      const rec = bundledById.get(id)!;
      const opts = hedgeOptions(rec, seed);
      return hedgeResult(
        rec,
        opts,
        opts.map((_, i) => (i === 0 ? 10 : 0)),
      )!;
    });
    const url = hedgeChallengeUrl(HREF, hedgeChallengeFrom(seed, game));
    const value = new URL(url).searchParams.get("challenge")!;
    const parsed = parseHedgeChallenge(value, bundledHedgeIds);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(hedgeFriendResults(parsed.challenge, bundledById)).toEqual(game);
  });
});

describe("the friend's bets", () => {
  it("are scored on each photo's real country, the game's own rule", () => {
    expect(hedgeFriendResult(C, 0, RECORDS)).toMatchObject({ id: "a1", score: 750 });
    expect(hedgeFriendResult(C, 0, RECORDS)!.options).toEqual(options("a1"));
    expect(hedgeFriendResult(C, 5, RECORDS)).toBeUndefined();
  });

  it("add up photo by photo, waiting for any record still loading", () => {
    expect(hedgeChallengeScore(C, RECORDS)).toBe(3750);
    expect(hedgeChallengeScore(C, RECORDS, 2)).toBe(1500);
    expect(hedgeChallengeScore(C, RECORDS, 0)).toBe(0);
    const partial = new Map([...RECORDS].filter(([id]) => id !== "d4"));
    expect(hedgeFriendResult(C, 3, partial)).toBeUndefined();
    expect(hedgeChallengeScore(C, partial, 3)).toBe(2250);
    expect(hedgeChallengeScore(C, partial)).toBeUndefined();
    expect(hedgeFriendResults(C, partial)).toBeUndefined();
  });

  it("go stale when a bet no longer fits the countries a photo offers", () => {
    const short = new Map(RECORDS);
    const rec = record("c3");
    rec.atlas!.topCountries = [
      { country: "FR", p: 0.6 },
      { country: "DE", p: 0.4 },
    ];
    short.set("c3", rec);
    expect(hedgeFriendResult(C, 2, short)).toBeNull();
    expect(hedgeFriendResults(C, short)).toBeNull();
    expect(hedgeChallengeScore(C, short)).toBeNull();
    // Stale wins over still loading: the game can set the link aside straight away.
    short.delete("e5");
    expect(hedgeFriendResults(C, short)).toBeNull();
  });

  it("are worded on the answer card with the right country's chips", () => {
    const theirs = hedgeFriendResult(C, 0, RECORDS)!;
    expect(hedgeFriendLine(theirs, countryName)).toBe("Your friend had 5 chips on France: 750.");
    const allIn = hedgeFriendResult({ ...C, bets: IDS.map((id) => bet(id, 1)) }, 0, RECORDS)!;
    expect(hedgeFriendLine(allIn, countryName)).toBe("Your friend had 1 chip on France: 190.");
  });
});

describe("the end of a challenge", () => {
  const theirs = hedgeFriendResults(C, RECORDS)!;

  it("calls the game won, lost or tied on the points", () => {
    expect(hedgeChallengeOutcome(play([10, 5, 5, 5, 5]), theirs)).toBe("won");
    expect(hedgeChallengeOutcome(play([0, 5, 5, 5, 5]), theirs)).toBe("lost");
    expect(hedgeChallengeOutcome(play([5, 5, 5, 5, 5]), theirs)).toBe("tied");
  });

  it("says by how much", () => {
    expect(hedgeChallengeLine(play([10, 5, 5, 5, 5]), theirs)).toBe(
      "You beat your friend's 3,750 by 250.",
    );
    expect(hedgeChallengeLine(play([0, 5, 5, 5, 5]), theirs)).toBe(
      "Your friend's 3,750 wins, by 750.",
    );
    expect(hedgeChallengeLine(play([5, 5, 5, 5, 5]), theirs)).toBe(
      "A dead heat: you both scored 3,750.",
    );
  });

  it("words a fresh challenge and a reply with numbers only", () => {
    const game = play([10, 10, 10, 10, 10]);
    const text = hedgeChallengeText(SEED, game, HREF);
    const atlas = game.reduce((a, r) => a + r.atlasScore, 0).toLocaleString("en-US");
    expect(text).toBe(
      [
        `Whereabout · Hedge your bets: 5,000 points. Atlas's probabilities: ${atlas}.`,
        "Same five photos, same four countries: can you read the odds better?",
        hedgeChallengeUrl(HREF, hedgeChallengeFrom(SEED, game)),
      ].join("\n"),
    );
    for (const name of ["France", "Germany", "Italy", "Spain", "FR"]) {
      expect(text).not.toContain(name);
    }
    expect(hedgeChallengeText(SEED, game, HREF, theirs).split("\n")[1]).toBe(
      "That beats your 3,750. Your turn to read the odds.",
    );
    expect(hedgeChallengeText(SEED, play([0, 5, 5, 5, 5]), HREF, theirs).split("\n")[1]).toBe(
      "Your 3,750 wins this time. Try them again?",
    );
    expect(hedgeChallengeText(SEED, play([5, 5, 5, 5, 5]), HREF, theirs).split("\n")[1]).toBe(
      "We tied. Play them again to break it?",
    );
  });

  it("draws a head to head of chips on the right country and points, photo by photo", () => {
    const mine = play([10, 0, 5, 7, 3]);
    const h = hedgeHeadToHead(mine, theirs, HREF);
    expect(h).toMatchObject({
      game: "Hedge your bets",
      youTotal: "3,170",
      friendTotal: "3,750",
      outcome: "lost",
    });
    expect(h.rows).toEqual([
      { label: "Photo 1", you: "10 on it · 1,000", friend: "5 on it · 750", winner: "you" },
      { label: "Photo 2", you: "0 on it · 0", friend: "5 on it · 750", winner: "friend" },
      { label: "Photo 3", you: "5 on it · 750", friend: "5 on it · 750", winner: "tie" },
      { label: "Photo 4", you: "7 on it · 910", friend: "5 on it · 750", winner: "you" },
      { label: "Photo 5", you: "3 on it · 510", friend: "5 on it · 750", winner: "friend" },
    ]);
    const drawn = JSON.stringify(headToHeadLayout(h));
    for (const name of ["France", "Germany", "a1"]) expect(drawn).not.toContain(name);
  });
});
