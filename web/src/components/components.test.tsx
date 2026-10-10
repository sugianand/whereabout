import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoundResult } from "@/lib/game/state";

import PhotoViewer, { ZOOM } from "./PhotoViewer";
import AtlasEyes from "./AtlasEyes";
import RevealCard, { verdict } from "./RevealCard";
import Summary, { shareText } from "./Summary";

function result(playerKm: number, playerScore: number, atlasScore?: number): RoundResult {
  return {
    round: { roundId: `r${playerKm}`, photo: { id: "p", imageUrl: "https://example.org/p.jpg" } },
    pin: { lng: 0, lat: 0 },
    reveal: {
      roundId: `r${playerKm}`,
      distanceKm: playerKm,
      score: playerScore,
      answer: { lng: 1, lat: 1, place: "Somewhere", country: "XX", credit: null },
    },
    atlas:
      atlasScore === undefined
        ? null
        : {
            lng: 1,
            lat: 1,
            confidence: 0.5,
            topCountries: [],
            clues: [],
            distanceKm: 10,
            score: atlasScore,
          },
  };
}

describe("verdict", () => {
  it("says who got closer", () => {
    expect(verdict(result(5, 4900, 100))).toBe("You beat Atlas on this one.");
    expect(verdict(result(5, 100, 4900))).toBe("Atlas got closer this time.");
    expect(verdict(result(5, 300, 300))).toBe("A dead heat with Atlas.");
    expect(verdict(result(5, 300))).toBeNull();
  });
});

describe("shareText", () => {
  it("shares the score and one square per round, never the places", () => {
    const text = shareText(
      "Daily Five, October 9",
      [
        result(10, 4967),
        result(400, 3846),
        result(2000, 1318),
        result(9000, 12),
        result(700, 3136),
      ],
      "https://example.org/whereabout/",
    );
    expect(text).toBe(
      [
        "Whereabout: Daily Five, October 9",
        "13,279 / 25,000",
        "🟩🟨🟧🟥🟨",
        "https://example.org/whereabout/",
      ].join("\n"),
    );
    expect(text).not.toContain("Somewhere");
  });

  it("adds the head-to-head when Atlas played", () => {
    const text = shareText("Practice game", [result(1, 5000, 10), result(1, 10, 5000)], "u");
    expect(text).toContain("Beat Atlas in 1 of 2 rounds");
  });
});

describe("Summary", () => {
  it("points to how Atlas works once Atlas has played", () => {
    render(
      <Summary results={[result(1, 5000, 10)]} title="Practice game" onPlayAgain={() => {}} />,
    );
    expect(screen.getByRole("link", { name: "How does Atlas guess?" })).toHaveAttribute(
      "href",
      "/atlas",
    );
  });

  it("has no Atlas link when Atlas sat the game out", () => {
    render(<Summary results={[result(1, 5000)]} title="Practice game" onPlayAgain={() => {}} />);
    expect(screen.queryByRole("link", { name: "How does Atlas guess?" })).toBeNull();
  });
});

describe("Where Atlas looked", () => {
  const looked = {
    grid: 3,
    crop: [0.25, 0, 0.5, 1],
    cells: [1, 0.5, 0, 0, 0, 0, 0, 0, 0],
  };

  it("shows the square CLIP saw, glowing where it mattered, described for screen readers", () => {
    render(<AtlasEyes src="https://example.org/p.jpg" looked={looked} />);
    const map = screen.getByRole("img", {
      name: "Where Atlas looked: mostly the top left of the photo",
    });
    const photo = map.querySelector("img")!;
    // A crop starting a quarter of the way in, half the photo wide: shift left by 50%, 200% wide.
    expect(photo.style.width).toBe("200%");
    expect(photo.style.left).toBe("-50%");
    const heat = within(map).getByTestId("atlas-eyes-heat");
    expect(heat.children).toHaveLength(9);
    expect((heat.children[0] as HTMLElement).style.opacity).toBe("0.9");
    expect((heat.children[8] as HTMLElement).style.opacity).toBe("0");
  });

  it("draws nothing for a malformed map", () => {
    const { container } = render(
      <AtlasEyes src="https://example.org/p.jpg" looked={{ ...looked, cells: [1] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("appears on the reveal card only when Atlas has a map for the photo", () => {
    const withMap = result(5, 4900, 100);
    withMap.atlas = { ...withMap.atlas!, looked };
    const { unmount } = render(<RevealCard result={withMap} isLast={false} onNext={() => {}} />);
    expect(screen.getByText("Where Atlas looked")).toBeInTheDocument();
    unmount();
    render(<RevealCard result={result(5, 4900, 100)} isLast={false} onNext={() => {}} />);
    expect(screen.queryByText("Where Atlas looked")).toBeNull();
  });
});

describe("PhotoViewer", () => {
  it("zooms in on the spot the player clicks, and back out", () => {
    render(<PhotoViewer src="https://example.org/p.jpg" roundKey="a" />);
    const button = screen.getByRole("button", { name: "Zoom in on the photo" });
    const img = screen.getByRole("img");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);

    fireEvent.click(button, { clientX: 50, clientY: 75 });
    expect(img.style.transform).toBe(`scale(${ZOOM})`);
    expect(img.style.transformOrigin).toBe("25% 75%");
    expect(screen.getByRole("button", { name: "Zoom out of the photo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.keyDown(button, { key: "Escape" });
    expect(img.style.transform).toBe("");
  });

  it("explains what to do when the photo can't load", () => {
    render(<PhotoViewer src="https://example.org/missing.jpg" roundKey="b" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toHaveTextContent("didn't load");
  });

  it("resets the zoom for the next round's photo", () => {
    const { rerender } = render(<PhotoViewer src="https://example.org/1.jpg" roundKey="1" />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<PhotoViewer src="https://example.org/2.jpg" roundKey="2" />);
    expect(screen.getByRole("button", { name: "Zoom in on the photo" })).toBeInTheDocument();
  });
});
