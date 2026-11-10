import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";

import { hotRound, type HotPin, type HotRound } from "./hotCold";
import {
  encodeHotChallenge,
  friendPhotoLine,
  hotChallengeFrom,
  hotChallengeLine,
  hotChallengeText,
  hotChallengeUrl,
  parseHotChallenge,
  type HotChallenge,
} from "./hotChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6"];
const C: HotChallenge = {
  ids: ["a1", "b2", "c3", "d4", "e5"],
  scores: [5820, 3412, 0, 6000, 2210],
  foundOn: [1, 2, 0, 1, 3],
};

/** A photo with `misses` far pins before the one that found it at `km`; `found` false: all missed. */
function round(id: string, misses: number, km: number, found = true): HotRound {
  const miss: HotPin = { at: { lng: 0, lat: 0 }, km: 15_000, bearing: 90, found: false };
  const pins: HotPin[] = Array.from({ length: misses }, () => miss);
  if (found) pins.push({ at: { lng: 1, lat: 1 }, km, bearing: 0, found: true });
  return hotRound(id, pins, null);
}

describe("hot and cold challenge links", () => {
  it("round-trip the photos, the points and the pins", () => {
    const value = encodeHotChallenge(C);
    expect(value).toBe("a1.b2.c3.d4.e5_5820.3412.0.6000.2210_1.2.0.1.3");
    expect(parseHotChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
  });

  it("turn away links that aren't a game Hot and cold could have given", () => {
    for (const value of [
      "",
      "a1.b2.c3.d4.e5_5820.3412.0.6000.2210",
      "a1.b2.c3.d4_5820.3412.0.6000_1.2.0.1",
      "a1.b2.c3.d4.a1_5820.3412.0.6000.2210_1.2.0.1.3",
      "a1.b2.c3.d4.e5_5820.3412.0.6000_1.2.0.1.3",
      "a1.b2.c3.d4.e5_5820.3412.0.6000.2210_1.2.0.1.4",
      "a1.b2.c3.d4.e5_5820.3412.0.6000.-1_1.2.0.1.3",
      "a1.b2.c3.d4.e5_5820.3412.0.6000.2210_1.2.0.1.3_x",
      // More than a pin's points: 6001 on the first pin, 5001 never found, 5501 on the second.
      "a1.b2.c3.d4.e5_5820.3412.0.6001.2210_1.2.0.1.3",
      "a1.b2.c3.d4.e5_5820.3412.5001.6000.2210_1.2.0.1.3",
      "a1.b2.c3.d4.e5_5820.5501.0.6000.2210_1.2.0.1.3",
      // Less than its pin's bonus: found first time is at least 1,000.
      "a1.b2.c3.d4.e5_999.3412.0.6000.2210_1.2.0.1.3",
    ]) {
      expect(parseHotChallenge(value, DEALABLE), value).toEqual({ ok: false, reason: "malformed" });
    }
    expect(parseHotChallenge("a1.b2.c3.d4.zz_5820.3412.0.6000.2210_1.2.0.1.3", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("come from a finished game, on the page's own address", () => {
    const results = [round("a1", 0, 0), round("b2", 1, 0), round("c3", 3, 0, false)];
    const c = hotChallengeFrom(results);
    expect(c.ids).toEqual(["a1", "b2", "c3"]);
    expect(c.scores).toEqual([6000, 5500, results[2]!.score]);
    expect(c.foundOn).toEqual([1, 2, 0]);
    expect(hotChallengeUrl("https://x.dev/whereabout/hot-cold/?challenge=old&y#z", C)).toBe(
      "https://x.dev/whereabout/hot-cold/?challenge=a1.b2.c3.d4.e5_5820.3412.0.6000.2210_1.2.0.1.3",
    );
  });

  it("parse back every game a player can finish", () => {
    const results = [
      round("a1", 0, 0),
      round("b2", 1, 2500),
      round("c3", 2, 40),
      round("d4", 3, 0, false),
      round("e5", 0, 9000),
    ];
    const c = hotChallengeFrom(results);
    expect(parseHotChallenge(encodeHotChallenge(c), DEALABLE)).toEqual({ ok: true, challenge: c });
  });

  it("say how a game went against the friend's points", () => {
    // The friend has 17,442.
    const perfect = C.ids.map((id) => round(id, 0, 0));
    expect(hotChallengeLine(perfect, C)).toBe("You won the challenge by 12,558 points.");
    const none = C.ids.map((id) => round(id, 3, 0, false));
    expect(hotChallengeLine(none, C)).toMatch(/^Your friend won by [\d,]+ points\.$/);
    const level: HotChallenge = { ...C, scores: perfect.map((r) => r.score) };
    expect(hotChallengeLine(perfect, level)).toBe("A dead heat with your friend.");
    const byOne: HotChallenge = { ...C, scores: [6000, 6000, 6000, 6000, 5999] };
    expect(hotChallengeLine(perfect, byOne)).toBe("You won the challenge by 1 point.");
  });

  it("say how the friend did on each photo", () => {
    expect(friendPhotoLine(C, 0)).toBe("5,820 points, found on pin 1");
    expect(friendPhotoLine(C, 2)).toBe("0 points, not found");
  });

  it("write a message with the score and the link, answering the friend when there was one", () => {
    const results = C.ids.map((id, i) => round(id, i === 1 ? 1 : 0, 0));
    const href = "https://x.dev/whereabout/hot-cold/?challenge=a1.b2.c3.d4.e5_1_1";
    expect(hotChallengeText(results, href)).toBe(
      [
        "Whereabout · Hot and cold: 29,500 of 30,000 points, 4 of 5 countries found with the first pin.",
        "Same five photos, three pins each: can you beat me?",
        "https://x.dev/whereabout/hot-cold/?challenge=a1.b2.c3.d4.e5_6000.5500.6000.6000.6000_1.2.1.1.1",
      ].join("\n"),
    );
    expect(hotChallengeText(results, href, C).split("\n")[1]).toBe(
      "That beats your 17,442. Your turn to beat mine.",
    );
    const worse = C.ids.map((id) => round(id, 3, 0, false));
    expect(hotChallengeText(worse, href, C).split("\n")[1]).toBe(
      "Your 17,442 wins this time. Try them again?",
    );
  });

  it("never name a place or a country", () => {
    const real = photos.slice(0, 5).map((p) => round(p.id, 1, 300));
    const text = hotChallengeText(real, "https://x.dev/hot-cold");
    for (const p of photos) {
      expect(text).not.toContain(p.place);
    }
  });
});
