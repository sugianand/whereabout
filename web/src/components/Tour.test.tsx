import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoundResult } from "@/lib/game/state";
import { setTheme } from "@/lib/theme";
import type { LegResult, TourRecord } from "@/lib/tour";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Summary, { tourLegLine } from "./Summary";
import Tour, { legStatus } from "./Tour";
import { ROUTE_COLORS } from "./TourGlobe";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

beforeEach(() => resetFakes());

const LEGS = [
  { continent: "Europe" as const, photos: 120 },
  { continent: "Africa" as const, photos: 40 },
  { continent: "Asia" as const, photos: 80 },
];

describe("the World Tour page", () => {
  it("shows every leg in route order, cleared, next or ahead, each with its game", () => {
    const record: TourRecord = {
      Europe: { tries: 2, best: { you: 16200, atlas: 14000 }, cleared: "2026-11-18" },
      Asia: { tries: 3, best: { you: 9000, atlas: 12500 }, cleared: null },
    };
    render(<Tour legs={LEGS} record={record} />);
    expect(screen.getByTestId("tour-progress")).toHaveTextContent("1 of 3 continents cleared");
    expect(screen.getByRole("progressbar", { name: "Continents cleared" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    const stops = screen.getAllByTestId("tour-stop");
    expect(stops.map((s) => [s.dataset.continent, s.dataset.state])).toEqual([
      ["Europe", "cleared"],
      ["Africa", "next"],
      ["Asia", "ahead"],
    ]);
    expect(stops[0]).toHaveTextContent("Cleared 18 Nov 2026. Best: 16,200 to Atlas's 14,000.");
    expect(within(stops[0]).getByRole("link", { name: "Play Europe again" })).toHaveAttribute(
      "href",
      "/?region=europe",
    );
    expect(stops[1]).toHaveTextContent("Next stop");
    expect(stops[1]).toHaveTextContent("Not visited yet.");
    expect(stops[1]).toHaveTextContent("Five of 40 photos taken in Africa.");
    expect(within(stops[1]).getByRole("link", { name: "Play Africa" })).toHaveAttribute(
      "href",
      "/?region=africa",
    );
    expect(stops[2]).toHaveTextContent(
      "Atlas holds it. Your closest: 3,500 points behind, over 3 games.",
    );
  });

  it("says when the tour is complete", () => {
    const won = { tries: 1, best: { you: 2, atlas: 1 }, cleared: "2026-11-18" };
    render(<Tour legs={LEGS} record={{ Europe: won, Africa: won, Asia: won }} />);
    expect(screen.getByTestId("tour-progress")).toHaveTextContent(
      "Tour complete: you've beaten Atlas on all 3 continents.",
    );
    expect(screen.queryByText("Next stop")).toBeNull();
  });

  it("reads the tour this browser keeps", () => {
    localStorage.setItem(
      "whereabout:tour",
      JSON.stringify({ Africa: { tries: 1, best: { you: 9, atlas: 8 }, cleared: "2026-11-17" } }),
    );
    try {
      render(<Tour legs={LEGS} />);
      expect(screen.getByTestId("tour-progress")).toHaveTextContent("1 of 3 continents cleared");
      expect(screen.getAllByTestId("tour-stop")[0].dataset.state).toBe("next");
    } finally {
      localStorage.removeItem("whereabout:tour");
    }
  });

  it("words a tied best and a single game", () => {
    expect(legStatus({ tries: 1, best: { you: 5000, atlas: 5000 }, cleared: null })).toBe(
      "Your best tied Atlas at 5,000, over 1 game.",
    );
  });

  it("offers to share the tour only once a leg is played, and shares its margins as text", async () => {
    const { unmount } = render(<Tour legs={LEGS} record={{}} />);
    expect(screen.queryByRole("button", { name: "Share your tour" })).toBeNull();
    unmount();

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    render(
      <Tour
        legs={LEGS}
        record={{
          Europe: { tries: 2, best: { you: 16200, atlas: 14000 }, cleared: "2026-11-18" },
          Asia: { tries: 3, best: { you: 9000, atlas: 12500 }, cleared: null },
        }}
      />,
    );
    const share = screen.getByTestId("tour-share");
    expect(
      within(share).getByRole("button", { name: "Share your tour" }),
    ).toHaveAccessibleDescription("Your World Tour: 1 of 3 continents cleared.");
    fireEvent.click(within(share).getByRole("button", { name: "Share as text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0][0] as string).split("\n").slice(0, 2)).toEqual([
      "Whereabout World Tour: 1 of 3 continents cleared against Atlas",
      "Europe +2,200 ✓ · Africa not played · Asia −3,500",
    ]);
    expect(within(share).getByRole("status")).toHaveTextContent("Tour copied. Paste it anywhere.");
    vi.unstubAllGlobals();
  });
});

type Features = { features: { properties: Record<string, unknown> }[] };

describe("the route on a globe", () => {
  const record: TourRecord = {
    Europe: { tries: 1, best: { you: 9, atlas: 8 }, cleared: "2026-11-17" },
    Africa: { tries: 2, best: { you: 9, atlas: 8 }, cleared: "2026-11-18" },
  };

  async function loadedMap() {
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));
    return map;
  }

  it("draws each stop and arc with its state, and flies to the next stop", async () => {
    render(<Tour legs={LEGS} record={record} />);
    const map = await loadedMap();
    const stops = map.sources["tour-stops"].data as Features;
    expect(stops.features.map((f) => [f.properties.continent, f.properties.state])).toEqual([
      ["Europe", "cleared"],
      ["Africa", "cleared"],
      ["Asia", "next"],
    ]);
    const arcs = map.sources["tour-arcs"].data as Features;
    expect(arcs.features.map((f) => f.properties.state)).toEqual(["flown", "next"]);
    expect(map.flyToCalls).toHaveLength(1);
    expect(map.flyToCalls[0].center).toEqual([95, 35]);
    const globe = screen.getByTestId("tour-globe");
    expect(globe).toHaveAttribute("data-lit", "1");
    expect(globe).toHaveAttribute("data-flown-to", "Asia");
    expect(globe).toHaveAccessibleName(
      "Globe of the World Tour's route: Europe, then Africa, then Asia. 1 of 2 legs between them flown; next stop Asia.",
    );
  });

  it("jumps instead of flying when the player asks for less motion", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      render(<Tour legs={LEGS} record={{}} />);
      const map = await loadedMap();
      expect(map.flyToCalls).toHaveLength(0);
      expect(map.jumpToCalls.map((c) => c.center)).toEqual([[15, 50]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("repaints the route by day when the site turns light, keeping the camera", async () => {
    render(<Tour legs={LEGS} record={record} />);
    const map = await loadedMap();
    expect(screen.getByTestId("tour-globe")).toHaveAttribute("data-light", "night");
    try {
      act(() => setTheme("light"));
      expect(screen.getByTestId("tour-globe")).toHaveAttribute("data-light", "day");
      expect(JSON.stringify(map.paint["tour-arcs-flown"]["line-color"])).toContain(
        ROUTE_COLORS.day.cleared,
      );
      expect(JSON.stringify(map.paint["tour-stops"]["circle-color"])).toContain(
        ROUTE_COLORS.day.next,
      );
      expect(map.flyToCalls).toHaveLength(1);
    } finally {
      act(() => setTheme("system"));
    }
  });

  it("stays on the whole route once the tour is complete", async () => {
    const won = { tries: 1, best: { you: 2, atlas: 1 }, cleared: "2026-11-18" };
    render(<Tour legs={LEGS} record={{ Europe: won, Africa: won, Asia: won }} />);
    const map = await loadedMap();
    expect(map.flyToCalls).toHaveLength(0);
    expect(map.jumpToCalls).toHaveLength(0);
    expect(screen.getByTestId("tour-globe")).toHaveAttribute("data-lit", "2");
  });

  it("says so when the browser can't draw the globe, with the list still there", async () => {
    resetFakes();
    vi.doMock("maplibre-gl", () => {
      throw new Error("no WebGL");
    });
    try {
      vi.resetModules();
      const { default: FreshTour } = await import("./Tour");
      render(<FreshTour legs={LEGS} record={{}} />);
      expect(await screen.findByText(/can't draw the globe/)).toBeInTheDocument();
      expect(screen.getAllByTestId("tour-stop")).toHaveLength(3);
    } finally {
      vi.doUnmock("maplibre-gl");
      vi.resetModules();
    }
  });
});

function result(i: number, you: number, atlas: number): RoundResult {
  return {
    round: {
      roundId: `r${i}`,
      photo: { id: `p${i}`, imageUrl: "https://example.org/p.jpg" },
      hintsAvailable: 3,
    },
    pin: { lng: 0, lat: 0 },
    clues: [],
    reveal: {
      roundId: `r${i}`,
      distanceKm: 100,
      score: you,
      hintsUsed: 0,
      answer: { lng: 1, lat: 1, place: "Somewhere", country: "FR", credit: null },
    },
    atlas: { guess: { lng: 2, lat: 2 }, distanceKm: 200, score: atlas, confidence: 0.5 },
  } as unknown as RoundResult;
}

const leg = (over: Partial<LegResult>): LegResult => ({
  continent: "Europe",
  game: { you: 15000, atlas: 12000 },
  won: true,
  firstClear: true,
  held: true,
  cleared: 1,
  total: 3,
  next: "Africa",
  ...over,
});

describe("the World Tour on the results screen", () => {
  it("words each outcome of a leg", () => {
    expect(tourLegLine(leg({}))).toBe(
      "Europe cleared: you beat Atlas on its home ground by 3,000 points.",
    );
    expect(tourLegLine(leg({ firstClear: false }))).toBe(
      "You beat Atlas in Europe again, by 3,000 points.",
    );
    expect(
      tourLegLine(leg({ won: false, firstClear: false, game: { you: 9000, atlas: 12000 } })),
    ).toBe("Atlas won this one in Europe by 3,000 points, but the leg stays yours.");
    const lost = { won: false, firstClear: false, held: false };
    expect(tourLegLine(leg({ ...lost, game: { you: 9000, atlas: 12000 } }))).toBe(
      "Atlas holds Europe by 3,000 points: beat it here to clear this leg.",
    );
    expect(tourLegLine(leg({ ...lost, game: { you: 9000, atlas: 9000 } }))).toBe(
      "A tie with Atlas in Europe: beat it to clear this leg.",
    );
  });

  it("leads a cleared leg to the next stop", () => {
    const onPlayLeg = vi.fn();
    render(
      <Summary
        results={[result(1, 5000, 4000)]}
        title="Europe game"
        onPlayAgain={() => {}}
        tour={leg({})}
        onPlayLeg={onPlayLeg}
      />,
    );
    const card = screen.getByRole("region", { name: "World Tour" });
    expect(card).toHaveTextContent("1 of 3 continents cleared.");
    expect(within(card).getByRole("link", { name: "See the tour →" })).toHaveAttribute(
      "href",
      "/tour",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Next stop: Africa" }));
    expect(onPlayLeg).toHaveBeenCalledWith("Africa");
  });

  it("offers no next stop while this leg is still Atlas's, and none once the tour is done", () => {
    const { rerender } = render(
      <Summary
        results={[result(1, 3000, 4000)]}
        title="Europe game"
        onPlayAgain={() => {}}
        tour={leg({
          won: false,
          firstClear: false,
          held: false,
          cleared: 0,
          next: "Europe",
          game: { you: 3000, atlas: 4000 },
        })}
        onPlayLeg={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /Next stop/ })).toBeNull();
    rerender(
      <Summary
        results={[result(1, 5000, 4000)]}
        title="Europe game"
        onPlayAgain={() => {}}
        tour={leg({ cleared: 3, next: null })}
        onPlayLeg={() => {}}
      />,
    );
    expect(screen.getByRole("region", { name: "World Tour" })).toHaveTextContent(
      "You've beaten Atlas on all 3 continents.",
    );
    expect(screen.queryByRole("button", { name: /Next stop/ })).toBeNull();
  });

  it("is not on the results of other games", () => {
    render(<Summary results={[result(1, 5000, 4000)]} title="Fresh game" onPlayAgain={() => {}} />);
    expect(screen.queryByRole("region", { name: "World Tour" })).toBeNull();
  });
});
