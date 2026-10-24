import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoundResult } from "@/lib/game/state";

import PhotoViewer, { ZOOM } from "./PhotoViewer";
import AtlasEyes from "./AtlasEyes";
import RevealCard, { hintNote, verdict } from "./RevealCard";
import Summary from "./Summary";

function result(playerKm: number, playerScore: number, atlasScore?: number): RoundResult {
  return {
    round: {
      roundId: `r${playerKm}`,
      photo: { id: "p", imageUrl: "https://example.org/p.jpg" },
      hintsAvailable: 3,
    },
    pin: { lng: 0, lat: 0 },
    clues: [],
    reveal: {
      roundId: `r${playerKm}`,
      distanceKm: playerKm,
      score: playerScore,
      hintsUsed: 0,
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

describe("hintNote", () => {
  it("says what the hints cost, and nothing without hints", () => {
    const r = result(5, 1900, 100);
    expect(hintNote(r)).toBeNull();
    expect(hintNote({ ...r, reveal: { ...r.reveal, hintsUsed: 1 } })).toBe(
      "You took 1 hint, so this round was worth up to 4,000 points.",
    );
    expect(hintNote({ ...r, reveal: { ...r.reveal, hintsUsed: 3 } })).toBe(
      "You took 3 hints, so this round was worth up to 2,000 points.",
    );
  });
});

describe("verdict", () => {
  it("says who got closer", () => {
    expect(verdict(result(5, 4900, 100))).toBe("You beat Atlas on this one.");
    expect(verdict(result(5, 100, 4900))).toBe("Atlas got closer this time.");
    expect(verdict(result(5, 300, 300))).toBe("A dead heat with Atlas.");
    expect(verdict(result(5, 300))).toBeNull();
  });
});

describe("Summary", () => {
  it("points to how Atlas works once Atlas has played", () => {
    render(<Summary results={[result(1, 5000, 10)]} title="Fresh game" onPlayAgain={() => {}} />);
    expect(screen.getByRole("link", { name: "How does Atlas guess?" })).toHaveAttribute(
      "href",
      "/atlas",
    );
  });

  it("previews the spoiler-free card and copies it where there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <Summary
        results={[result(10, 4967, 100), result(9000, 12, 3000)]}
        title="Fresh game"
        onPlayAgain={() => {}}
      />,
    );
    const card = screen.getByRole("figure", { name: "Your share card" });
    expect(
      within(card).getByRole("img", { name: "Round 1: within 25 km, beat Atlas" }),
    ).toBeVisible();
    expect(
      within(card).getByRole("img", { name: "Round 2: over 2,500 km, Atlas got closer" }),
    ).toBeVisible();
    expect(card).not.toHaveTextContent("Somewhere");

    fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    expect(await screen.findByText("Result copied. Paste it anywhere.")).toBeInTheDocument();
    const sent = writeText.mock.calls[0][0] as string;
    expect(sent).toContain("✅❌");
    expect(sent).not.toContain("Somewhere");
  });

  it("has no Atlas link when Atlas sat the game out", () => {
    render(<Summary results={[result(1, 5000)]} title="Fresh game" onPlayAgain={() => {}} />);
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
  function setup() {
    render(<PhotoViewer src="https://example.org/p.jpg" roundKey="a" />);
    const button = screen.getByRole("button", { name: "Zoom in on the photo" });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    } as DOMRect);
    return { button, img: screen.getByRole("img") };
  }
  const zoomedName = { name: "Zoom out of the photo" };

  it("zooms in on the spot the player clicks, and back out", () => {
    const { button, img } = setup();
    fireEvent.click(button, { clientX: 100, clientY: 75 });
    // The tapped point stays put: 100 - (100 - 0) * 2.5 = -150.
    expect(img.style.transform).toBe(`translate(-150px, -112.5px) scale(${ZOOM})`);
    expect(screen.getByRole("button", zoomedName)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", zoomedName), { clientX: 10, clientY: 10 });
    expect(screen.getByRole("button", { name: "Zoom in on the photo" })).toBeInTheDocument();
    expect(img.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("keyboard + zooms on the centre and Escape resets", () => {
    const { button, img } = setup();
    fireEvent.click(button); // keyboard click: no position
    expect(img.style.transform).toBe(`translate(-300px, -225px) scale(${ZOOM})`);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Zoom in on the photo" })).toBeInTheDocument();
    fireEvent.keyDown(button, { key: "+" });
    expect(img.style.transform).toContain("scale(1.5)");
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(img.style.transform).toBe("translate(-140px, -75px) scale(1.5)");
    fireEvent.keyDown(button, { key: "0" });
    expect(img.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("dragging pans a zoomed photo without toggling the zoom", () => {
    const { button, img } = setup();
    fireEvent.click(button, { clientX: 200, clientY: 150 });
    const zoomedTransform = img.style.transform;
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.click(button, { clientX: 150, clientY: 150 }); // the click that follows a drag
    expect(img.style.transform).not.toBe(zoomedTransform);
    expect(screen.getByRole("button", zoomedName)).toBeInTheDocument();
  });

  it("shows Reset view only while zoomed", () => {
    const { button, img } = setup();
    expect(screen.queryByRole("button", { name: "Reset photo view" })).toBeNull();
    fireEvent.click(button, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Reset photo view" }));
    expect(screen.queryByRole("button", { name: "Reset photo view" })).toBeNull();
    expect(img.style.transform).toBe("translate(0px, 0px) scale(1)");
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

describe("RevealCard shortlist", () => {
  function withTop(top: { country: string; p: number }[], truth: string): RoundResult {
    const r = result(5, 100, 4900);
    return {
      ...r,
      reveal: { ...r.reveal, answer: { ...r.reveal.answer, country: truth } },
      atlas: { ...r.atlas!, topCountries: top },
    };
  }

  it("lists Atlas's likeliest countries and marks the right one", () => {
    render(
      <RevealCard
        result={withTop(
          [
            { country: "VN", p: 0.16 },
            { country: "LA", p: 0.81 },
            { country: "KH", p: 0.004 },
          ],
          "LA",
        )}
        isLast={false}
        onNext={() => {}}
      />,
    );
    const list = screen.getByRole("list", { name: "Atlas's shortlist" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Laos 81% (the right country)",
      "Vietnam 16%",
    ]);
  });

  it("says when the right country wasn't on it", () => {
    render(
      <RevealCard
        result={withTop(
          [
            { country: "FR", p: 0.6 },
            { country: "ES", p: 0.3 },
          ],
          "PT",
        )}
        isLast={false}
        onNext={() => {}}
      />,
    );
    expect(screen.getByText(/Portugal wasn't on it/)).toBeInTheDocument();
  });

  it("stays quiet with fewer than two countries", () => {
    render(
      <RevealCard
        result={withTop([{ country: "FR", p: 0.9 }], "FR")}
        isLast={false}
        onNext={() => {}}
      />,
    );
    expect(screen.queryByText(/shortlist/)).toBeNull();
  });
});

describe("RevealCard on phones", () => {
  function thinking(r: RoundResult): RoundResult {
    return {
      ...r,
      atlas: {
        ...r.atlas!,
        guessedPlace: "Hanoi, VN",
        topCountries: [
          { country: "VN", p: 0.6 },
          { country: "LA", p: 0.3 },
        ],
        clues: [{ label: "Rice paddies", p: 0.8 }],
      },
    };
  }

  it("folds Atlas's reasoning behind a toggle so the globe stays in view", () => {
    render(<RevealCard result={thinking(result(5, 100, 4900))} isLast={false} onNext={() => {}} />);
    const toggle = screen.getByRole("button", { name: "How Atlas guessed" });
    const panel = screen.getByTestId("atlas-thinking");
    // Hidden on phones, always shown from the md breakpoint up.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveClass("hidden", "md:block");
    expect(within(panel).getByText("Rice paddies")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide how Atlas guessed");
    expect(panel).not.toHaveClass("hidden");
  });

  it("keeps the score and the verdict outside the fold", () => {
    render(<RevealCard result={thinking(result(5, 100, 4900))} isLast={false} onNext={() => {}} />);
    const panel = screen.getByTestId("atlas-thinking");
    const verdictLine = screen.getByText("Atlas got closer this time.");
    expect(panel).not.toContainElement(verdictLine);
    expect(panel).not.toContainElement(screen.getByRole("button", { name: "Next photo" }));
  });

  it("folds again for the next round", () => {
    const first = thinking(result(5, 100, 4900));
    const { rerender } = render(<RevealCard result={first} isLast={false} onNext={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "How Atlas guessed" }));
    const second = { ...thinking(result(7, 200, 4000)) };
    rerender(<RevealCard result={second} isLast={false} onNext={() => {}} />);
    expect(screen.getByRole("button", { name: "How Atlas guessed" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("has no toggle when Atlas did not play the photo", () => {
    render(<RevealCard result={result(5, 100)} isLast={false} onNext={() => {}} />);
    expect(screen.queryByRole("button", { name: /How Atlas guessed/ })).toBeNull();
  });
});
