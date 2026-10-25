import { describe, expect, it } from "vitest";

import { calibrationNote, retrievalNote, systemLabel } from "@/lib/atlas";
import type { AtlasCalibrationSummary, AtlasRetrievalSummary } from "@/lib/game/types";

const run = (over: Partial<AtlasRetrievalSummary>): AtlasRetrievalSummary => ({
  versus: "ViT-L-14/openai, country then city",
  model: "ViT-B-32/laion2b_s34b_b79k",
  references: 4210,
  countries: 151,
  moved: 301,
  n: 388,
  dropped: {},
  k: 10,
  median_km_delta: -120.4,
  ci95: [-210.2, -35.7],
  ships: true,
  ...over,
});

describe("retrievalNote", () => {
  it("says the refined Atlas plays when the whole interval is below zero", () => {
    const note = retrievalNote(run({}));
    expect(note).toContain("4,210 geotagged reference photos");
    expect(note).toContain("on 301 of 388 photos");
    expect(note).toContain("median error went down by 120 km (95% interval −210 km to −36 km)");
    expect(note).toContain("this is the Atlas you play against");
  });

  it("says the game keeps Atlas without it when it does not clearly win", () => {
    const note = retrievalNote(run({ median_km_delta: 48.6, ci95: [-90.1, 160.3], ships: false }));
    expect(note).toContain("median error went up by 49 km (95% interval −90 km to +160 km)");
    expect(note).toContain("the game keeps the Atlas without it");
    expect(note).not.toContain("you play against");
  });

  it("reports a median that did not move as unchanged", () => {
    const note = retrievalNote(run({ median_km_delta: 0.2, ci95: [-3, 4], ships: false }));
    expect(note).toContain("median error did not change (95% interval −3 km to +4 km)");
  });
});

describe("systemLabel", () => {
  it("names the refined system after the model it refines", () => {
    expect(systemLabel("ViT-L-14/openai, country then city, then nearest reference photos")).toBe(
      "CLIP ViT-L/14 (OpenAI), country then city, then nearest reference photos",
    );
  });
});

describe("calibrationNote", () => {
  const cal = (over: Partial<AtlasCalibrationSummary>): AtlasCalibrationSummary => ({
    method: "temperature scaling",
    n: 380,
    folds: 5,
    blockDeg: 10,
    temperature: 1.3,
    raw: { nll: 2.1, ece: 0.081, bins: [] },
    calibrated: { nll: 2.0, ece: 0.032, bins: [] },
    ships: true,
    ...over,
  });

  it("gives the temperature, the held-out error before and after, and what the game shows", () => {
    const note = calibrationNote(cal({}));
    expect(note).toContain("came out at 1.30, so the raw model was a little overconfident");
    expect(note).toContain("went from 8.1% to 3.2%");
    expect(note).toMatch(/percentages in the game are the scaled ones\.$/);
  });

  it("says the game keeps the raw numbers when the fit did not hold up", () => {
    const note = calibrationNote(cal({ temperature: 0.99, ships: false }));
    expect(note).toContain("close to honest already");
    expect(note).toMatch(/game keeps the raw percentages\.$/);
  });
});
