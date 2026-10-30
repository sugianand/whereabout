import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeMap, FakeMarker, resetFakes } from "@/test/maplibre-mock";
import type { RoundResult } from "@/lib/game/state";
import { TOUR_FLY_MS, TOUR_HOLD_MS, tourStops } from "@/lib/gameTour";

import GameTour, { stopCaption, wholeGameCaption } from "./GameTour";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function round(i: number, pin: boolean, atlas: boolean): RoundResult {
  const truth = { lng: i * 20, lat: 10 };
  return {
    round: { roundId: `r${i}`, photo: { id: `p${i}`, imageUrl: "x" }, hintsAvailable: 0 },
    pin: pin ? { lng: i * 20 + 1, lat: 11 } : null,
    clues: [],
    reveal: {
      roundId: `r${i}`,
      distanceKm: pin ? 150 : null,
      score: 0,
      hintsUsed: 0,
      answer: { ...truth, place: `Place ${i + 1}`, country: null, credit: null },
    },
    atlas: atlas
      ? {
          lng: i * 20 + 5,
          lat: 10,
          confidence: 0.5,
          topCountries: [],
          clues: [],
          distanceKm: 3400,
          score: 0,
        }
      : null,
  };
}

const results = [round(0, true, true), round(1, true, false), round(2, false, true)];

async function renderTour(autoplay = true) {
  const view = render(<GameTour results={results} autoplay={autoplay} />);
  await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
  const map = FakeMap.instances[0];
  act(() => map.emit("load"));
  return { ...view, map, tour: screen.getByTestId("game-tour") };
}

function lineRounds(map: FakeMap) {
  const data = map.sources["tour-lines"].data as {
    features: { properties: { round: number } }[];
  };
  return [...new Set(data.features.map((f) => f.properties.round))];
}

const truthPins = () => FakeMarker.instances.filter((m) => m.map !== null);

beforeEach(() => {
  resetFakes();
  // No rAF in jsdom by default here: arcs draw whole, which keeps the assertions simple.
  vi.stubGlobal("requestAnimationFrame", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("captions", () => {
  it("names the round, the place and both distances", () => {
    const [first, , third] = tourStops(results);
    expect(stopCaption(first, 3, "km")).toBe(
      "Round 1 of 3: Place 1. You were 150 km away; Atlas 3,400 km.",
    );
    expect(stopCaption(third, 3, "km")).toBe(
      "Round 3 of 3: Place 3. No pin this round; Atlas 3,400 km.",
    );
  });

  it("counts the rounds in words for the whole game", () => {
    expect(wholeGameCaption(5)).toBe("All five rounds at once.");
    expect(wholeGameCaption(1)).toBe("Your one round on the globe.");
  });
});

describe("GameTour", () => {
  it("shows the globe only, without taking taps or drags", async () => {
    const { map } = await renderTour();
    expect(map.options.interactive).toBe(false);
  });

  it("flies from round to round, then pulls back to the whole game", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { map, tour } = await renderTour();
    expect(tour).toHaveAttribute("data-stop", "1");
    expect(screen.getByText(/^Round 1 of 3: Place 1\./)).toBeInTheDocument();
    expect(lineRounds(map)).toEqual([0]);
    expect(truthPins()).toHaveLength(1);
    expect(map.flyToCalls.at(-1)?.center).toEqual([expect.any(Number), expect.any(Number)]);

    act(() => vi.advanceTimersByTime(TOUR_FLY_MS + TOUR_HOLD_MS));
    expect(tour).toHaveAttribute("data-stop", "2");
    expect(lineRounds(map)).toEqual([0, 1]);
    expect(truthPins()).toHaveLength(2);

    act(() => vi.advanceTimersByTime(TOUR_FLY_MS + TOUR_HOLD_MS));
    expect(tour).toHaveAttribute("data-stop", "3");
    act(() => vi.advanceTimersByTime(TOUR_FLY_MS + TOUR_HOLD_MS));
    expect(tour).toHaveAttribute("data-stop", "all");
    expect(tour).not.toHaveAttribute("data-playing");
    expect(screen.getByText("All three rounds at once.")).toBeInTheDocument();
    expect(lineRounds(map)).toEqual([0, 1, 2]);
    expect(truthPins()).toHaveLength(3);
    // Earlier pins were kept, not dropped again at every stop.
    expect(FakeMarker.instances).toHaveLength(3);
  });

  it("jumps to a round when its button is pressed, and stops the tour there", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { tour } = await renderTour();
    fireEvent.click(screen.getByRole("button", { name: /Show round 3, Place 3/ }));
    expect(tour).toHaveAttribute("data-stop", "3");
    expect(screen.getByRole("button", { name: /Show round 3/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (let i = 0; i < 4; i++) act(() => vi.advanceTimersByTime(TOUR_FLY_MS + TOUR_HOLD_MS));
    expect(tour).toHaveAttribute("data-stop", "3");
  });

  it("opens on the whole game without autoplay, and flies through again on request", async () => {
    const { map, tour } = await renderTour(false);
    expect(tour).toHaveAttribute("data-stop", "all");
    expect(lineRounds(map)).toEqual([0, 1, 2]);
    expect(screen.getByRole("button", { name: "Whole game" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Fly through again" }));
    expect(tour).toHaveAttribute("data-stop", "1");
    expect(lineRounds(map)).toEqual([0]);
    expect(truthPins()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Flying…" })).toBeDisabled();
  });

  it("with reduced motion, opens on the whole game and jumps instead of flying", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    try {
      const { map, tour } = await renderTour();
      expect(tour).toHaveAttribute("data-stop", "all");
      expect(map.flyToCalls).toHaveLength(0);
      expect(map.jumpToCalls.length).toBeGreaterThan(0);
    } finally {
      // @ts-expect-error jsdom has no matchMedia; remove the stub after the test.
      delete window.matchMedia;
    }
  });
});
