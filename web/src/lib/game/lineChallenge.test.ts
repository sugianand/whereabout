import { describe, expect, it } from "vitest";

import photos from "@/data/photos.json";

import {
  encodeLineChallenge,
  lineChallengeFrom,
  lineChallengeLine,
  lineChallengeText,
  lineChallengeUrl,
  parseLineChallenge,
  type LineChallenge,
} from "./lineChallenge";
import type { RowResult } from "./lineUp";

const ROWS_OF = (n: number) =>
  Array.from({ length: n }, (_, r) => Array.from({ length: 4 }, (_, i) => `p${r * 4 + i}`));
const DEALABLE = [...ROWS_OF(5).flat(), "spare"];
const C: LineChallenge = { rows: ROWS_OF(5), points: [4, 2, 0, 1, 3] };
const VALUE = "p0.p1.p2.p3-p4.p5.p6.p7-p8.p9.p10.p11-p12.p13.p14.p15-p16.p17.p18.p19_4.2.0.1.3";

function result(order: readonly string[], points: number): RowResult {
  return {
    order,
    east: order,
    right: order.map((_, i) => i < points),
    points,
    atlas: null,
  };
}

describe("line-up challenge links", () => {
  it("round-trip the rows as dealt and the points", () => {
    expect(encodeLineChallenge(C)).toBe(VALUE);
    expect(parseLineChallenge(VALUE, DEALABLE)).toEqual({ ok: true, challenge: C });
    // A small catalog deals fewer rows, and its games can still be sent.
    const short = { rows: ROWS_OF(2), points: [4, 0] };
    expect(parseLineChallenge(encodeLineChallenge(short), DEALABLE)).toEqual({
      ok: true,
      challenge: short,
    });
  });

  it("turn away links that aren't a game Line them up could have dealt", () => {
    for (const value of [
      "",
      "_",
      VALUE.replace("_4.2.0.1.3", "_4.2.0.1"),
      VALUE.replace("_4.2.0.1.3", "_4.2.0.1.5"),
      VALUE.replace("_4.2.0.1.3", "_4.2.0.1.-1"),
      VALUE.replace("p3-", "-"),
      VALUE.replace("p3-", "p3.spare-"),
      VALUE.replace("p19", "p0"),
      VALUE.replace("p19", "p1!"),
      `${VALUE}_x`,
      `${VALUE.split("_")[0]}-p20.p21.p22.p23_4.2.0.1.3.0`,
    ]) {
      expect(parseLineChallenge(value, DEALABLE), value).toEqual({ ok: false, reason: "malformed" });
    }
    expect(parseLineChallenge(VALUE.replace("p19", "gone"), DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("come from a finished game's rows as dealt, not as locked, on the page's own address", () => {
    const rows = ROWS_OF(5);
    const results = rows.map((row, i) => result([...row].reverse(), C.points[i]));
    const c = lineChallengeFrom(rows, results);
    expect(c).toEqual(C);
    expect(lineChallengeUrl("https://x.dev/whereabout/line-up/?challenge=old&y#z", c)).toBe(
      `https://x.dev/whereabout/line-up/?challenge=${VALUE}`,
    );
  });

  it("say how a game went against the friend's points", () => {
    const mine = (points: number[]) => points.map((p, i) => result(C.rows[i], p));
    // The friend has 10.
    expect(lineChallengeLine(mine([4, 4, 4, 0, 0]), C)).toBe("You won the challenge by 2 in place.");
    expect(lineChallengeLine(mine([1, 1, 1, 1, 1]), C)).toBe("Your friend won by 5 in place.");
    expect(lineChallengeLine(mine([2, 2, 2, 2, 2]), C)).toBe("A dead heat with your friend.");
  });

  it("write a message with the count and the link, answering the friend when there was one", () => {
    const results = C.rows.map((row) => result(row, 4));
    const href = `https://x.dev/whereabout/line-up/?challenge=${VALUE}`;
    expect(lineChallengeText(C.rows, results, href)).toBe(
      [
        "Whereabout · Line them up: I put 20 of 20 photos in place, west to east.",
        "Same rows, same start: can you beat me?",
        `https://x.dev/whereabout/line-up/?challenge=${VALUE.replace("4.2.0.1.3", "4.4.4.4.4")}`,
      ].join("\n"),
    );
    expect(lineChallengeText(C.rows, results, href, C).split("\n")[1]).toBe(
      "That beats your 10. Your turn to beat mine.",
    );
    const worse = C.rows.map((row) => result(row, 0));
    expect(lineChallengeText(C.rows, worse, href, C).split("\n")[1]).toBe(
      "Your 10 wins this time. Try them again?",
    );
  });

  it("never name a place", () => {
    const rows = [0, 1, 2, 3, 4].map((r) => photos.slice(r * 4, r * 4 + 4).map((p) => p.id));
    const text = lineChallengeText(
      rows,
      rows.map((row) => result(row, 2)),
      "https://x.dev/line-up",
    );
    for (const p of photos) expect(text).not.toContain(p.place);
    expect(parseLineChallenge(text.split("challenge=")[1], photos.map((p) => p.id)).ok).toBe(true);
  });
});
