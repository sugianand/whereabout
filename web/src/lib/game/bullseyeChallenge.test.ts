import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";

import photos from "@/data/photos.json";

import { settleBet, type BullseyeRound } from "./bullseye";
import {
  bullseyeChallengeFrom,
  bullseyeChallengeHeld,
  bullseyeChallengeLine,
  bullseyeChallengeOutcome,
  bullseyeChallengeScore,
  bullseyeChallengeText,
  bullseyeChallengeUrl,
  bullseyeFriendBet,
  bullseyeHeadToHead,
  encodeBullseyeChallenge,
  parseBullseyeChallenge,
  type BullseyeChallenge,
} from "./bullseyeChallenge";
import { bundledDeck } from "./bundled";

const IDS = ["a1", "b2", "c3", "d4", "e5"];
const DEALT = [...IDS, "f6", "g7"];
const HREF = "https://example.org/whereabout/bullseye/?challenge=old";

// The sender: a 250 km ring held (1,000), a 750 km ring missed, a 2,000 km ring held (250), the
// 250 km ring missed by a whisker, and the widest held (100): 1,350 in all, three rings held.
const C: BullseyeChallenge = {
  ids: IDS,
  rings: [0, 1, 2, 0, 3],
  km: [120, 900, 1999, 251, 4300],
};

const round = (id: string, ring: number, km: number): BullseyeRound => ({
  id,
  you: settleBet({ lng: 10, lat: 20 }, ring, km),
  atlas: null,
});

/** A game scoring 1,000 + 500 + 0 + 0 + 100 = 1,600. */
const GAME = [
  round("a1", 0, 80),
  round("b2", 1, 700),
  round("c3", 0, 400),
  round("d4", 1, 760.2),
  round("e5", 3, 3000),
];

describe("a Bullseye challenge link", () => {
  it("round-trips the photos, rings by their keys and whole kilometres", () => {
    const value = encodeBullseyeChallenge(C);
    expect(value).toBe("a1.b2.c3.d4.e5_12314_120.900.1999.251.4300");
    expect(parseBullseyeChallenge(value, DEALT)).toEqual({ ok: true, challenge: C });
  });

  it("is made from a whole game, each distance rounded up so a ring keeps its verdict", () => {
    const c = bullseyeChallengeFrom(GAME);
    expect(c).toEqual({ ids: IDS, rings: [0, 1, 0, 1, 3], km: [80, 700, 400, 761, 3000] });
    // 760.2 km is outside the 750 km ring, and so is the 761 the link carries.
    expect(bullseyeFriendBet(c, 3)!.inside).toBe(false);
    expect(bullseyeChallengeFrom([round("a1", 0, 250.4)]).km).toEqual([251]);
    expect(bullseyeChallengeFrom([round("a1", 0, 249.6)]).km).toEqual([250]);
    expect(bullseyeFriendBet(bullseyeChallengeFrom([round("a1", 0, 250)]), 0)!.inside).toBe(true);
    // Every game's link reads back as the game it was.
    expect(bullseyeChallengeScore(c)).toBe(1600);
  });

  it("keeps only the challenge in the address", () => {
    expect(bullseyeChallengeUrl(HREF, C)).toBe(
      "https://example.org/whereabout/bullseye/?challenge=a1.b2.c3.d4.e5_12314_120.900.1999.251.4300",
    );
  });

  it.each([
    ["", "malformed"],
    ["a1.b2.c3.d4.e5_12314", "malformed"],
    ["a1.b2.c3.d4_1231_1.2.3.4", "malformed"],
    ["a1.b2.c3.d4.a1_12314_1.2.3.4.5", "malformed"],
    ["a1.b2.c3.d4.e5_12315_1.2.3.4.5", "malformed"],
    ["a1.b2.c3.d4.e5_02314_1.2.3.4.5", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.-5", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.5.5", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.05", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.2.5", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.20051", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.1e3", "malformed"],
    ["a1.b2.c3.d4.e5_12314_1.2.3.4.5_6", "malformed"],
    ["a1.b2.c3.d4.zz_12314_1.2.3.4.5", "missing"],
  ])("sets %j aside as %s", (value, reason) => {
    expect(parseBullseyeChallenge(value, DEALT)).toEqual({ ok: false, reason });
  });

  it("takes the longest distance there is", () => {
    expect(parseBullseyeChallenge("a1.b2.c3.d4.e5_44444_0.0.0.0.20050", DEALT).ok).toBe(true);
  });
});

describe("the sender's bets", () => {
  it("are settled by the game's own rule, never read from the link", () => {
    expect(bullseyeFriendBet(C, 0)).toMatchObject({ ring: 0, km: 120, inside: true, score: 1000 });
    expect(bullseyeFriendBet(C, 1)).toMatchObject({ inside: false, score: 0 });
    expect(bullseyeFriendBet(C, 3)).toMatchObject({ ring: 0, km: 251, inside: false });
    expect(bullseyeFriendBet(C, 5)).toBeNull();
    expect(bullseyeChallengeScore(C)).toBe(1350);
    expect(bullseyeChallengeHeld(C)).toBe(3);
  });

  it("add up photo by photo, for the running score the friend sees", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => bullseyeChallengeScore(C, n))).toEqual([
      0, 1000, 1000, 1250, 1250, 1350,
    ]);
  });
});

describe("how a game went against the challenge", () => {
  it("says who won and by how much", () => {
    expect(bullseyeChallengeOutcome(GAME, C)).toBe("won");
    expect(bullseyeChallengeLine(GAME, C)).toBe("You beat your friend's 1,350 by 250.");
    const low = [round("a1", 0, 400), GAME[1]!, GAME[2]!, GAME[3]!, GAME[4]!];
    expect(bullseyeChallengeOutcome(low, C)).toBe("lost");
    expect(bullseyeChallengeLine(low, C)).toBe("Your friend's 1,350 wins, by 750.");
    const level = [
      round("a1", 0, 1),
      round("b2", 2, 1),
      round("c3", 3, 1),
      GAME[3]!,
      round("e5", 0, 3000),
    ];
    expect(bullseyeChallengeOutcome(level, C)).toBe("tied");
    expect(bullseyeChallengeLine(level, C)).toBe("A dead heat: you both scored 1,350.");
  });

  it("sends the score, the rings held and a link to the same five", () => {
    expect(bullseyeChallengeText(GAME, HREF)).toBe(
      [
        "Whereabout · Bullseye: 1,600 points, 3 of 5 rings held.",
        "Same five photos: how tight a ring dare you bet?",
        "https://example.org/whereabout/bullseye/?challenge=a1.b2.c3.d4.e5_12124_80.700.400.761.3000",
      ].join("\n"),
    );
    expect(bullseyeChallengeText(GAME, HREF, C).split("\n")[1]).toBe(
      "That beats your 1,350. Your turn to bet.",
    );
  });
});

describe("the Bullseye head to head", () => {
  it("is each side's points and ring on each photo, the higher taking it", () => {
    const h = bullseyeHeadToHead(GAME, C, HREF);
    expect(h).toMatchObject({
      game: "Bullseye",
      youTotal: "1,600 pts",
      friendTotal: "1,350 pts",
      outcome: "won",
    });
    expect(h.rows).toEqual([
      { label: "Photo 1", you: "1,000 · 250 km", friend: "1,000 · 250 km", winner: "tie" },
      { label: "Photo 2", you: "500 · 750 km", friend: "0 · 750 km", winner: "you" },
      { label: "Photo 3", you: "0 · 250 km", friend: "250 · 2,000 km", winner: "friend" },
      { label: "Photo 4", you: "0 · 750 km", friend: "0 · 250 km", winner: "tie" },
      { label: "Photo 5", you: "100 · 5,000 km", friend: "100 · 5,000 km", winner: "tie" },
    ]);
    expect(bullseyeHeadToHead(GAME, C, HREF, "mi").rows[0]!.you).toMatch(/ mi$/);
  });

  it("draws no photo, place or country from the catalog", () => {
    const ids = bundledDeck.ids.slice(0, 5);
    const c: BullseyeChallenge = { ids, rings: [0, 1, 2, 3, 0], km: [10, 20, 30, 40, 50] };
    const results = ids.map((id) => round(id, 1, 100));
    const words = headToHeadLayout(bullseyeHeadToHead(results, c, HREF))
      .texts.map((t) => t.text)
      .join("\n");
    for (const id of ids) {
      const p = photos.find((x) => x.id === id)!;
      expect(words).not.toContain(id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(p.country);
    }
  });
});
