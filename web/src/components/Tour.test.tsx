import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoundResult } from "@/lib/game/state";
import type { LegResult, TourRecord } from "@/lib/tour";

import Summary, { tourLegLine } from "./Summary";
import Tour, { legStatus } from "./Tour";

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
