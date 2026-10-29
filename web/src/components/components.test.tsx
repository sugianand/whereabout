import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoundResult } from "@/lib/game/state";
import { EMPTY_RECORD, type PlayerRecord } from "@/lib/playerRecord";

import PhotoViewer, { ZOOM } from "./PhotoViewer";
import AtlasEyes from "./AtlasEyes";
import RevealCard, { hintNote, timeUpNote, verdict } from "./RevealCard";
import Summary, { blitzLine, challengeResultLine } from "./Summary";

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

describe("Blitz on the reveal and the summary", () => {
  const noPin: RoundResult = {
    ...result(0, 0, 3000),
    pin: null,
    timedOut: true,
    reveal: { ...result(0, 0).reveal, distanceKm: null, score: 0 },
  };

  it("says when the clock, not the player, put the guess in", () => {
    expect(timeUpNote(result(5, 4900))).toBeNull();
    expect(timeUpNote({ ...result(5, 4900), timedOut: true })).toBe(
      "Time's up! Your pin went in where it stood.",
    );
    expect(timeUpNote(noPin)).toBe("Time's up, and no pin on the globe: 0 points this round.");
  });

  it("shows a round with no pin as 'No pin', not a distance", () => {
    render(<RevealCard result={noPin} isLast={false} onNext={() => {}} />);
    expect(screen.getByTestId("time-up")).toHaveTextContent("no pin on the globe");
    expect(screen.getByText("No pin")).toBeInTheDocument();
    expect(screen.getByText(/You scored 0 points\./)).toBeInTheDocument();
  });

  it("lists a no-pin round on the summary, and the Blitz best under the score", () => {
    render(
      <Summary
        results={[noPin]}
        title="Blitz"
        onPlayAgain={() => {}}
        blitz={{ best: 9000, previous: 9000, isNew: false }}
      />,
    );
    expect(screen.getByText("No pin")).toBeInTheDocument();
    expect(screen.getByTestId("blitz-best")).toHaveTextContent("Your Blitz best is 9,000 points.");
  });

  it("celebrates a first Blitz and a new best", () => {
    expect(blitzLine({ best: 100, previous: null, isNew: true })).toBe(
      "Your first Blitz: that's the score to beat.",
    );
    expect(blitzLine({ best: 12000, previous: 9000, isNew: true })).toBe(
      "A new Blitz best! Up from 9,000 points.",
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
  it("offers a challenge link only when the browser deals the photos", () => {
    const { rerender } = render(
      <Summary results={[result(1, 5000, 10)]} title="Fresh game" onPlayAgain={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Challenge a friend" })).toBeNull();
    rerender(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        canChallenge
      />,
    );
    expect(screen.getByRole("button", { name: "Challenge a friend" })).toBeInTheDocument();
  });

  it("says who won a friend's challenge, and by how much", () => {
    expect(challengeResultLine(15000, 14210)).toBe("You won the challenge by 790 points.");
    expect(challengeResultLine(9000, 21000)).toBe("Your friend won by 12,000 points.");
    expect(challengeResultLine(100, 100)).toBe("A dead heat with your friend.");
  });

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

  it("shows the record against Atlas, with a streak that lapses after a missed day", () => {
    const record: PlayerRecord = {
      games: 12,
      roundsVsAtlas: 58,
      roundsWon: 21,
      best: 19_204,
      lastDaily: "2026-10-23",
      streak: 4,
      bestStreak: 6,
      continents: {},
      badges: [],
    };
    const props = { results: [result(1, 5000, 10)], title: "Fresh game", onPlayAgain: () => {} };
    const { rerender } = render(
      <Summary {...props} record={record} today={new Date("2026-10-24T08:00:00Z")} />,
    );
    const panel = screen.getByRole("region", { name: "Your record against Atlas" });
    const value = (label: string) => within(panel).getByText(label).nextElementSibling;
    expect(value("Games played")).toHaveTextContent("12");
    expect(value("Rounds won against Atlas")).toHaveTextContent("21");
    expect(within(panel).getByText("of 58 rounds")).toBeInTheDocument();
    expect(value("Best game")).toHaveTextContent("19,204");
    expect(value("Daily Five streak")).toHaveTextContent("4 days");
    expect(within(panel).getByText("best 6 days")).toBeInTheDocument();

    rerender(<Summary {...props} record={record} today={new Date("2026-10-25T08:00:00Z")} />);
    expect(value("Daily Five streak")).toHaveTextContent("0 days");
  });

  it("shows every badge, lights the earned ones and marks the ones this game earned", () => {
    const record: PlayerRecord = { ...EMPTY_RECORD, games: 3, badges: ["first-win", "bullseye"] };
    render(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={record}
        newBadges={["bullseye"]}
      />,
    );
    const list = screen.getByRole("list", { name: "Badges 2 of 5" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).getByRole("listitem", { name: "First win: earned" })).toBeVisible();
    expect(
      within(list).getByRole("listitem", { name: "Bullseye: earned this game" }),
    ).toHaveTextContent("New");
    expect(within(list).getByRole("listitem", { name: "Hard won: not yet" })).toHaveTextContent(
      "Outscore Atlas over a whole Hard game",
    );
    expect(screen.getByText("New this game: Bullseye")).toHaveAttribute("role", "status");
  });

  it("shows rounds by continent and where the player beat Atlas most and least", () => {
    const record: PlayerRecord = {
      ...EMPTY_RECORD,
      games: 4,
      roundsVsAtlas: 15,
      roundsWon: 6,
      continents: {
        Asia: { rounds: 5, vsAtlas: 5, won: 1 },
        Europe: { rounds: 6, vsAtlas: 6, won: 4 },
        Oceania: { rounds: 4, vsAtlas: 4, won: 1 },
        Africa: { rounds: 2, vsAtlas: 0, won: 0 },
      },
    };
    render(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={record}
      />,
    );
    const table = screen.getByRole("table", { name: "By continent" });
    const rows = within(table).getAllByRole("row").slice(1);
    // Continents in the site's usual order, unplayed ones left out.
    expect(rows.map((r) => r.textContent)).toEqual([
      "Africa2–",
      "Asia51 of 5",
      "Europe64 of 6",
      "Oceania41 of 4",
    ]);
    const line = screen.getByText(/^You beat Atlas most often in/);
    // Asia and Oceania tie at 1 in 5 vs 1 in 4: Oceania's 25% is higher, so Asia is least.
    expect(line).toHaveTextContent(
      "You beat Atlas most often in Europe (4 of 6 rounds) and least often in Asia (1 of 5 rounds).",
    );
  });

  it("waits for enough rounds on two continents before naming most and least", () => {
    const one: PlayerRecord = {
      ...EMPTY_RECORD,
      games: 1,
      continents: { Europe: { rounds: 5, vsAtlas: 5, won: 3 } },
    };
    const { rerender } = render(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={one}
      />,
    );
    expect(
      screen.getByText(/^Play 3 rounds against Atlas on each of two continents/),
    ).toBeInTheDocument();
    const even: PlayerRecord = {
      ...one,
      continents: {
        Asia: { rounds: 3, vsAtlas: 3, won: 1 },
        Europe: { rounds: 6, vsAtlas: 6, won: 2 },
      },
    };
    rerender(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={even}
      />,
    );
    expect(screen.getByText(/just as often on every continent/)).toBeInTheDocument();
    rerender(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={{ ...one, continents: {} }}
      />,
    );
    expect(screen.queryByRole("table", { name: "By continent" })).toBeNull();
  });

  it("resets the record only after the player confirms", () => {
    const onReset = vi.fn();
    render(
      <Summary
        results={[result(1, 5000, 10)]}
        title="Fresh game"
        onPlayAgain={() => {}}
        record={{ ...EMPTY_RECORD, games: 3, best: 9000 }}
        onResetRecord={onReset}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset record" }));
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset record" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset it" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("has no record panel before there is a record", () => {
    render(<Summary results={[result(1, 5000)]} title="Fresh game" onPlayAgain={() => {}} />);
    expect(screen.queryByRole("region", { name: "Your record against Atlas" })).toBeNull();
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

describe("RevealCard reality check", () => {
  const sure = (confidence: number): RoundResult => {
    const r = result(5, 100, 4900);
    return {
      ...r,
      atlas: {
        ...r.atlas!,
        confidence,
        guessedPlace: "Hanoi, VN",
        topCountries: [{ country: "VN", p: confidence }],
      },
    };
  };
  const bands = [
    { lo: 0, hi: 0.2, n: 3, right: 0 },
    { lo: 0.2, hi: 0.4, n: 40, right: 11 },
    { lo: 0.4, hi: 0.6, n: 30, right: 14 },
    { lo: 0.6, hi: 0.8, n: 20, right: 15 },
    { lo: 0.8, hi: 1, n: 9, right: 8 },
  ];

  it("says how often Atlas is right when it is this sure", () => {
    render(<RevealCard result={sure(0.62)} isLast={false} onNext={() => {}} sureness={bands} />);
    expect(screen.getByTestId("atlas-thinking")).toHaveTextContent(
      "62% sure of the country. When Atlas is 60–80% sure, it names the right country in 15 of 20 photos.",
    );
  });

  it("stays quiet when the band has too few photos to mean anything", () => {
    render(<RevealCard result={sure(0.9)} isLast={false} onNext={() => {}} sureness={bands} />);
    expect(screen.getByTestId("atlas-thinking")).toHaveTextContent("90% sure of the country.");
    expect(screen.queryByTestId("atlas-sureness")).toBeNull();
  });
});

describe("RevealCard real clues", () => {
  function withClues(r: RoundResult): RoundResult {
    return {
      ...r,
      reveal: {
        ...r.reveal,
        answer: {
          ...r.reveal.answer,
          clues: { drivingSide: "left", climateGroup: "Arid", landCover: "Permanent water bodies" },
        },
      },
    };
  }

  it("shows each real clue next to Atlas's read, marked right or wrong", () => {
    const r = withClues(result(5, 100, 4900));
    r.atlas = {
      ...r.atlas!,
      topCountries: [{ country: "GB", p: 0.6 }],
      clues: [{ label: "Temperate climate", p: 0.7 }],
    };
    render(<RevealCard result={r} isLast={false} onNext={() => {}} />);
    const list = screen.getByRole("list", { name: "The real clues, and what Atlas read" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Drives on the left✓ Atlas read it right: Atlas: drives on the left (its pick, United Kingdom)",
      "Arid climate✗ Atlas read it wrong: Atlas: temperate climate",
      "Mostly water around itAtlas didn’t say",
    ]);
    expect(rows.map((row) => row.dataset.right)).toEqual(["true", "false", "null"]);
    // Inside the fold on phones, with Atlas's own reasoning.
    expect(screen.getByTestId("atlas-thinking")).toContainElement(list);
  });

  it("shows the real clues alone when Atlas sat the photo out", () => {
    render(<RevealCard result={withClues(result(5, 100))} isLast={false} onNext={() => {}} />);
    expect(screen.getByRole("button", { name: "The real clues" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "The real clues" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Drives on the left", "Arid climate", "Mostly water around it"]);
    expect(screen.queryByText(/Atlas didn’t say/)).toBeNull();
  });
});
