import { describe, expect, it } from "vitest";

import { headToHeadLayout } from "@/lib/headToHead";
import { countryName } from "@/lib/countries";

import photos from "@/data/photos.json";

import { bundledTrustIds } from "./bundled";
import type { GameRecord } from "./deck";
import { trustResult, type TrustCall, type TrustResult } from "./trustAtlas";
import {
  encodeTrustChallenge,
  parseTrustChallenge,
  trustChallengeFrom,
  trustChallengeLine,
  trustChallengeOutcome,
  trustChallengeScore,
  trustChallengeText,
  trustChallengeUrl,
  trustFriendLine,
  trustFriendResult,
  trustFriendResults,
  trustHeadToHead,
  type TrustChallenge,
} from "./trustChallenge";

const IDS = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j10"];
const DEALT = [...IDS, "k11", "l12"];
const HREF = "https://example.org/whereabout/trust-atlas/?challenge=old#x";

/** Atlas names France for every photo; it is right on the first five and wrong on the rest. */
const record = (id: string, i: number) =>
  ({
    photo: { id, country: i < 5 ? "FR" : "DE" },
    atlas: { confidence: 0.7, topCountries: [{ country: "FR", p: 0.7 }] },
  }) as unknown as GameRecord;
const RECORDS = new Map(IDS.map((id, i) => [id, record(id, i)]));

const t: TrustCall = "trust";
const d: TrustCall = "doubt";
// The sender trusts every photo: right on the first five, wrong on the last five.
const C: TrustChallenge = { ids: IDS, calls: IDS.map(() => t) };

const play = (calls: TrustCall[]): TrustResult[] =>
  calls.map((call, i) => trustResult(RECORDS.get(IDS[i]!)!, call)!);
/** Right on the first `n` photos and wrong on the rest. */
const rightOn = (n: number): TrustResult[] =>
  play(IDS.map((_, i) => (i < n ? (i < 5 ? t : d) : i < 5 ? d : t)));

describe("the challenge link", () => {
  it("round-trips through the address", () => {
    const value = encodeTrustChallenge({ ids: IDS, calls: [t, t, d, t, d, d, d, t, t, d] });
    expect(value).toBe("a1.b2.c3.d4.e5.f6.g7.h8.i9.j10_ttdtdddttd");
    expect(parseTrustChallenge(value, DEALT)).toEqual({
      ok: true,
      challenge: { ids: IDS, calls: [t, t, d, t, d, d, d, t, t, d] },
    });
  });

  it("is made from a whole game, its photos in order and the call made on each", () => {
    expect(trustChallengeFrom(play([d, t, t, t, t, t, t, t, t, d]))).toEqual({
      ids: IDS,
      calls: [d, t, t, t, t, t, t, t, t, d],
    });
  });

  it("keeps only the challenge in the page's address", () => {
    expect(trustChallengeUrl(HREF, C)).toBe(
      "https://example.org/whereabout/trust-atlas/?challenge=a1.b2.c3.d4.e5.f6.g7.h8.i9.j10_tttttttttt",
    );
  });

  const ten = IDS.join(".");
  it.each([
    ["", "nothing"],
    [ten, "no calls"],
    [`${IDS.slice(0, 9).join(".")}_ttttttttt`, "nine photos"],
    [`${ten}.k11_ttttttttttt`, "eleven photos"],
    [`${ten}_ttttttttt`, "a call short"],
    [`${ten}_ttttttttttt`, "a call too many"],
    [`${ten}_tttttttttx`, "a call that isn't one"],
    [`${ten}_TTTTTTTTTT`, "shouted calls"],
    [`${ten}_tttttttttt_t`, "a third part"],
    [`a1.a1.c3.d4.e5.f6.g7.h8.i9.j10_tttttttttt`, "a photo twice"],
    [`a1.b2.c3.d4.e5.f6.g7.h8.i9.j/10_tttttttttt`, "a photo id that isn't one"],
  ])("sets aside %j (%s) as malformed", (value) => {
    expect(parseTrustChallenge(value, DEALT)).toEqual({ ok: false, reason: "malformed" });
  });

  it("says when a photo isn't dealt any more", () => {
    expect(parseTrustChallenge("a1.b2.c3.d4.e5.f6.g7.h8.i9.zz_tttttttttt", DEALT)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("takes a challenge over the photos the real game deals", () => {
    const ids = bundledTrustIds.slice(0, 10);
    expect(ids).toHaveLength(10);
    expect(parseTrustChallenge(`${ids.join(".")}_tdtdtdtdtd`, bundledTrustIds).ok).toBe(true);
  });
});

describe("the friend's calls", () => {
  it("are judged on each photo's real country, the game's own rule", () => {
    expect(trustFriendResult(C, 0, RECORDS)).toMatchObject({ id: "a1", call: t, correct: true });
    expect(trustFriendResult(C, 7, RECORDS)).toMatchObject({ id: "h8", call: t, correct: false });
    expect(trustFriendResult(C, 10, RECORDS)).toBeNull();
  });

  it("add up photo by photo, waiting for any record still loading", () => {
    expect(trustChallengeScore(C, RECORDS)).toBe(5);
    expect(trustChallengeScore(C, RECORDS, 3)).toBe(3);
    expect(trustChallengeScore(C, RECORDS, 0)).toBe(0);
    const partial = new Map([...RECORDS].filter(([id]) => id !== "d4"));
    expect(trustFriendResult(C, 3, partial)).toBeNull();
    expect(trustChallengeScore(C, partial, 3)).toBe(3);
    expect(trustChallengeScore(C, partial)).toBeNull();
    expect(trustFriendResults(C, partial)).toBeNull();
  });

  it("never count a photo Atlas named no country for", () => {
    const blank = new Map(RECORDS);
    blank.set("a1", { photo: { id: "a1", country: "FR" }, atlas: null } as unknown as GameRecord);
    expect(trustFriendResult(C, 0, blank)).toBeNull();
  });

  it("are worded on the answer card beside yours", () => {
    const [mine] = play([t]);
    const theirs = trustFriendResult(C, 0, RECORDS)!;
    expect(trustFriendLine(mine!, theirs)).toBe("Your friend trusted it too: called it.");
    const [doubted] = play([d]);
    expect(trustFriendLine(doubted!, theirs)).toBe("Your friend trusted it: called it.");
    const wrong = trustFriendResult({ ids: IDS, calls: IDS.map(() => d) }, 0, RECORDS)!;
    expect(trustFriendLine(mine!, wrong)).toBe("Your friend doubted it: missed it.");
  });
});

describe("the end of a challenge", () => {
  const theirs = trustFriendResults(C, RECORDS)!;

  it("calls the game won, lost or tied on the calls right", () => {
    expect(rightOn(8).filter((r) => r.correct)).toHaveLength(8);
    expect(trustChallengeOutcome(rightOn(8), theirs)).toBe("won");
    expect(trustChallengeOutcome(rightOn(3), theirs)).toBe("lost");
    expect(trustChallengeOutcome(rightOn(5), theirs)).toBe("tied");
  });

  it("says by how much", () => {
    expect(trustChallengeLine(rightOn(8), theirs)).toBe("You beat your friend's 5 of 10 by 3.");
    expect(trustChallengeLine(rightOn(3), theirs)).toBe("Your friend's 5 of 10 wins, by 2.");
    expect(trustChallengeLine(rightOn(5), theirs)).toBe(
      "A dead heat: you both called 5 of 10 right.",
    );
  });

  it("words a fresh challenge and a reply with numbers only", () => {
    const game = rightOn(8);
    const text = trustChallengeText(game, HREF);
    expect(text).toBe(
      [
        "Whereabout · Trust Atlas?: 8 of 10 called right. Atlas's own sureness: 5 of 10.",
        "Same ten photos: can you tell when Atlas is right?",
        `https://example.org/whereabout/trust-atlas/?challenge=a1.b2.c3.d4.e5.f6.g7.h8.i9.j10_${game.map((r) => r.call[0]).join("")}`,
      ].join("\n"),
    );
    expect(text).not.toContain("France");
    expect(trustChallengeText(game, HREF, theirs).split("\n")[1]).toBe(
      "That beats your 5. Your turn to read Atlas.",
    );
    expect(trustChallengeText(rightOn(3), HREF, theirs).split("\n")[1]).toBe(
      "Your 5 wins this time. Try them again?",
    );
    expect(trustChallengeText(rightOn(5), HREF, theirs).split("\n")[1]).toBe(
      "We tied. Play them again to break it?",
    );
  });

  it("draws a head to head of calls, photo by photo", () => {
    const mine = play([t, d, t, t, t, d, d, t, d, d]);
    const h = trustHeadToHead(mine, theirs, HREF);
    expect(h).toMatchObject({
      game: "Trust Atlas?",
      youTotal: "8 of 10",
      friendTotal: "5 of 10",
      outcome: "won",
    });
    expect(h.rows.slice(0, 3)).toEqual([
      { label: "Photo 1", you: "Trusted · right", friend: "Trusted · right", winner: "tie" },
      { label: "Photo 2", you: "Doubted · wrong", friend: "Trusted · right", winner: "friend" },
      { label: "Photo 3", you: "Trusted · right", friend: "Trusted · right", winner: "tie" },
    ]);
    expect(h.rows[5]).toEqual({
      label: "Photo 6",
      you: "Doubted · right",
      friend: "Trusted · wrong",
      winner: "you",
    });
    expect(h.rows[7]!.winner).toBe("tie");
  });

  it("draws no photo, place or country from the catalog", () => {
    const ids = bundledTrustIds.slice(0, 10);
    const records = new Map(
      ids.map((id) => {
        const p = photos.find((x) => x.id === id)!;
        return [
          id,
          { photo: p, atlas: { confidence: 0.6, topCountries: [{ country: p.country, p: 0.6 }] } },
        ];
      }),
    ) as unknown as Map<string, GameRecord>;
    const c: TrustChallenge = { ids, calls: ids.map(() => t) };
    const results = trustFriendResults(c, records)!;
    const words = headToHeadLayout(trustHeadToHead(results, results, HREF))
      .texts.map((x) => x.text)
      .join("\n");
    for (const id of ids) {
      const p = photos.find((x) => x.id === id)!;
      expect(words).not.toContain(id);
      expect(words).not.toContain(p.place);
      expect(words).not.toContain(countryName(p.country));
    }
  });
});
