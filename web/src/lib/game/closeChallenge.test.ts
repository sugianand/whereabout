import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";

import {
  closeChallengeFrom,
  closeChallengeLine,
  closeChallengeText,
  closeChallengeUrl,
  encodeCloseChallenge,
  parseCloseChallenge,
  type CloseChallenge,
} from "./closeChallenge";
import type { CloseResult } from "./closeUp";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6"];
const C: CloseChallenge = { ids: ["a1", "b2", "c3", "d4", "e5"], seed: 4_000_000_000, points: [3, 2, 0, 1, 3] };

function result(id: string, wrong: number): CloseResult {
  const names = ["XA", "XB", "XC"].slice(0, wrong);
  return { id, wrong: names, points: [3, 2, 1, 0][wrong], atlas: null };
}

describe("close-up challenge links", () => {
  it("round-trip the photos, the seed and the points", () => {
    const value = encodeCloseChallenge(C);
    expect(value).toBe(`a1.b2.c3.d4.e5_${(4_000_000_000).toString(36)}_3.2.0.1.3`);
    expect(parseCloseChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseCloseChallenge(encodeCloseChallenge(c), DEALABLE)).toEqual({ ok: true, challenge: c });
    }
  });

  it("turn away links that aren't a game Close-up could have dealt", () => {
    for (const value of [
      "",
      "a1.b2.c3.d4.e5_1z_3.2.0.1",
      "a1.b2.c3.d4_1z_3.2.0.1.3",
      "a1.b2.c3.d4.a1_1z_3.2.0.1.3",
      "a1.b2.c3.d4.e5_1z_3.2.0.1.4",
      "a1.b2.c3.d4.e5_1z_3.2.0.1.-1",
      "a1.b2.c3.d4.e5_1z141z4_3.2.0.1.3",
      "a1.b2.c3.d4.e5_Z!_3.2.0.1.3",
      "a1.b2.c3.d4.e5_1z_3.2.0.1.3_x",
      "a1.b2.c3.d4.e5__3.2.0.1.3",
    ]) {
      expect(parseCloseChallenge(value, DEALABLE), value).toEqual({ ok: false, reason: "malformed" });
    }
    expect(parseCloseChallenge("a1.b2.c3.d4.zz_1z_3.2.0.1.3", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("come from a finished game, on the page's own address", () => {
    const results = ["a1", "b2", "c3", "d4", "e5"].map((id, i) => result(id, [0, 1, 3, 2, 0][i]));
    const c = closeChallengeFrom(results, 77);
    expect(c).toEqual({ ids: ["a1", "b2", "c3", "d4", "e5"], seed: 77, points: [3, 2, 0, 1, 3] });
    expect(closeChallengeUrl("https://x.dev/whereabout/close-up/?challenge=old&y#z", c)).toBe(
      "https://x.dev/whereabout/close-up/?challenge=a1.b2.c3.d4.e5_25_3.2.0.1.3",
    );
  });

  it("say how a game went against the friend's points", () => {
    const mine = (wrongs: number[]) => wrongs.map((w, i) => result(C.ids[i], w));
    // The friend has 9.
    expect(closeChallengeLine(mine([0, 0, 0, 0, 1]), C)).toBe("You won the challenge by 5 points.");
    expect(closeChallengeLine(mine([0, 3, 3, 1, 2]), C)).toBe("Your friend won by 3 points.");
    expect(closeChallengeLine(mine([0, 0, 0, 3, 3]), C)).toBe("A dead heat with your friend.");
    expect(closeChallengeLine(mine([0, 0, 0, 3, 2]), C)).toBe("You won the challenge by 1 point.");
  });

  it("write a message with the score and the link, answering the friend when there was one", () => {
    const results = C.ids.map((id) => result(id, 0));
    const href = "https://x.dev/whereabout/close-up/?challenge=a1.b2.c3.d4.e5_1z_3.2.0.1.3";
    const fresh = closeChallengeText(results, 5, href);
    expect(fresh).toBe(
      [
        "Whereabout · Close-up: I named these five crops for 15 of 15 points.",
        "Same photos, same names: can you beat me?",
        "https://x.dev/whereabout/close-up/?challenge=a1.b2.c3.d4.e5_5_3.3.3.3.3",
      ].join("\n"),
    );
    expect(closeChallengeText(results, 5, href, C).split("\n")[1]).toBe(
      "That beats your 9. Your turn to beat mine.",
    );
    const worse = C.ids.map((id) => result(id, 3));
    expect(closeChallengeText(worse, 5, href, C).split("\n")[1]).toBe(
      "Your 9 wins this time. Try them again?",
    );
  });

  it("never name a place or a country", () => {
    const real = photos.slice(0, 5).map((p) => result(p.id, 1));
    const text = closeChallengeText(real, 123, "https://x.dev/close-up");
    for (const p of photos) {
      expect(text).not.toContain(p.place);
    }
  });
});
