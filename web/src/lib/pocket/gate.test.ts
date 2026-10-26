import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/pocket_cases.json";

import { declineMessage, gateOf, screen, type PocketGate, type PrivacyReason } from "./gate";
import type { PocketMeta } from "./locate";

const meta = fixture.meta as PocketMeta;
const gate = gateOf(meta)!;

describe("Pocket Atlas privacy gate (pinned to Python by data/fixtures/pocket_cases.json)", () => {
  it("is in the shared index, people then indoor", () => {
    expect(gate).not.toBeNull();
    expect(gate.reasons.map((r) => r.name)).toEqual(["people", "indoor"]);
  });

  it.each(fixture.cases.map((c, i) => [i, c] as const))("case %i screens like Python", (_, c) => {
    const got = screen(gate, c.image);
    expect(got.passed).toBe(c.gate.passed);
    expect(got.reasons).toEqual(c.gate.reasons);
    for (const [reason, want] of Object.entries(c.gate.scores)) {
      expect(got.scores[reason as PrivacyReason]).toBeCloseTo(want, 2);
    }
  });

  it("the fixture has a photo of people, of a room, of both and of a place", () => {
    const verdicts = fixture.cases.map((c) => c.gate.reasons.join("+"));
    expect(verdicts).toEqual(expect.arrayContaining(["", "people", "indoor", "people+indoor"]));
  });

  it("declines a score exactly at the threshold, like SceneGate.judge", () => {
    const kyotoPerson = fixture.cases.find((c) => c.gate.reasons.join() === "people")!;
    const at = screen(gate, kyotoPerson.image).scores.people!;
    const withBar = (t: number): PocketGate => ({
      ...gate,
      reasons: gate.reasons.map((r) => (r.name === "people" ? { ...r, threshold: t } : r)),
    });
    // Rounded scores: nudge just below and above the unrounded one.
    expect(screen(withBar(at - 1e-3), kyotoPerson.image).reasons).toContain("people");
    expect(screen(withBar(at + 1e-3), kyotoPerson.image).passed).toBe(true);
  });

  it("is scale-free in the embedding, as Python normalises it", () => {
    const c = fixture.cases.find((x) => !x.gate.passed)!;
    expect(screen(gate, c.image.map((v) => v * 7))).toEqual(screen(gate, c.image));
  });

  it("refuses an embedding of the wrong size", () => {
    expect(() => screen(gate, [1, 2, 3])).toThrow(/dims/);
  });

  it("treats an index without a sound gate as having none", () => {
    expect(gateOf({ ...meta, gate: undefined })).toBeNull();
    expect(gateOf({ ...meta, gate: { ...gate, reasons: [] } })).toBeNull();
    expect(gateOf({ ...meta, gate: { ...gate, logitScale: Number.NaN } })).toBeNull();
    const short = { ...gate.reasons[0], direction: [1, 0] };
    expect(gateOf({ ...meta, gate: { ...gate, reasons: [short] } })).toBeNull();
  });
});

describe("declineMessage", () => {
  it("names the reason and never guesses a place", () => {
    expect(declineMessage(["people"])).toMatch(/there are people in it\./);
    expect(declineMessage(["indoor"])).toMatch(/taken indoors\./);
    expect(declineMessage(["people", "indoor"])).toMatch(/people in it, and .* indoors/);
    for (const r of [["people"], ["indoor"]] as PrivacyReason[][]) {
      expect(declineMessage(r)).toMatch(/^Atlas won't guess this one/);
    }
  });
});
