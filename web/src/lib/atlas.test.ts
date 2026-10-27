import { describe, expect, it } from "vitest";

import {
  calibrationNote,
  clueHeadNote,
  pocketClueHeadNote,
  geocellNote,
  retrievalNote,
  systemLabel,
} from "@/lib/atlas";
import type {
  AtlasCalibrationSummary,
  AtlasClueHeadResult,
  AtlasGeocellHeadSummary,
  AtlasRetrievalSummary,
} from "@/lib/game/types";

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

describe("geocellNote", () => {
  const head = (over: Partial<AtlasGeocellHeadSummary>): AtlasGeocellHeadSummary => ({
    versus: "ViT-L-14/openai, country then city",
    model: "ViT-B-32/laion2b_s34b_b79k",
    references: 4300,
    cells: 64,
    l2: 0.01,
    tauKm: 300,
    moved: 250,
    n: 388,
    median_km_delta: -80.6,
    ci95: [-150.2, -12.4],
    ships: true,
    ...over,
  });

  it("says the head places the pin when the whole interval is below zero", () => {
    const note = geocellNote(head({}));
    expect(note).toContain("one of 64 regions of the world, learned from 4,300 geotagged");
    expect(note).toContain("on 250 of 388 photos");
    expect(note).toContain("median error went down by 81 km (95% interval −150 km to −12 km)");
    expect(note).toContain("it places the pin you play against");
  });

  it("says the game keeps its pin when the head does not clearly win", () => {
    const note = geocellNote(head({ median_km_delta: 210, ci95: [90, 330], ships: false }));
    expect(note).toContain("median error went up by 210 km (95% interval +90 km to +330 km)");
    expect(note).toContain("the game keeps the pin without it");
    expect(note).not.toContain("you play against");
  });
});

describe("systemLabel", () => {
  it("names the geocell systems after the models they read", () => {
    expect(systemLabel("ViT-B-32/laion2b_s34b_b79k geocell head, alone")).toBe(
      "CLIP ViT-B/32 (LAION-2B) geocell head, alone",
    );
  });

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

describe("clueHeadNote", () => {
  const head: AtlasClueHeadResult = {
    concept: "climate_group",
    clueGroup: "climate",
    classes: ["Tropical", "Arid", "Temperate", "Continental", "Polar"],
    baseline: "the zero-shot climate clue",
    model: "ViT-B-32/laion2b_s34b_b79k",
    n: 380,
    references: 4100,
    headAccuracy: 0.712,
    baselineAccuracy: 0.453,
    majorityAccuracy: 0.4,
    accuracyDelta: 0.259,
    ci95: [0.204, 0.313],
    l2: 0.01,
    ships: true,
  };

  it("compares the probe with the old clue on unseen places and says it now writes the clue", () => {
    expect(clueHeadNote(head)).toBe(
      "A probe trained on 4,100 reference photos to read the climate got it right on 71% of " +
        "380 game photos from places it never trained on; the zero-shot climate clue got 45% " +
        "(difference +26 points, 95% interval +20 points to +31 points). The whole interval is " +
        "above zero, so the probe writes that clue at the reveal.",
    );
  });

  it("says whether Pocket Atlas's own probe writes the clue for the player's photo", () => {
    const pocket = { ...head, model: "ViT-B-32/openai" };
    expect(pocketClueHeadNote(pocket)).toBe(
      "On your own photos, Atlas runs a smaller CLIP model (ViT-B-32/openai) in your browser. A " +
        "probe trained on that model's view of the same reference photos read the climate right " +
        "on 71% of 380 game photos; the zero-shot climate clue got 45% (difference +26 points, " +
        "95% interval +20 points to +31 points). So it runs in your browser and writes that clue " +
        "for your photo.",
    );
    expect(pocketClueHeadNote({ ...pocket, ci95: [-0.01, 0.3], ships: false })).toMatch(
      /not a clear win, so your photo keeps its old clue\.$/,
    );
  });

  it("says the reveal keeps its old source when the probe does not clearly win", () => {
    const note = clueHeadNote({
      ...head,
      concept: "driving_side",
      baseline: "the driving side of the country Atlas guessed",
      headAccuracy: 0.8,
      baselineAccuracy: 0.81,
      accuracyDelta: -0.01,
      ci95: [-0.05, 0.03],
      ships: false,
    });
    expect(note).toContain("to read which side of the road traffic drives on");
    expect(note).toContain("(difference −1 point, 95% interval −5 points to +3 points)");
    expect(note).toMatch(/keeps its old source for now\.$/);
  });
});
