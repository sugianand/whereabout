import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadChallengeLog } from "@/lib/challengeLog";
import { QUICK_RECORD_KEY, loadFreeTallies } from "@/lib/game/quickRecord";
import type { GameRecord } from "@/lib/game/deck";
import { ODD_DAILY_KEY, dailyOddDealer } from "@/lib/game/oddDaily";
import { BEST_ODD_KEY } from "@/lib/game/oddOneOut";
import type { CatalogPhoto } from "@/lib/game/types";
import { stubCanvas } from "@/test/canvas";
import { gameFor } from "@/test/deck";

import OddOneOut from "./OddOneOut";

function record(id: string, country: string, atlasCountry: string | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas:
      atlasCountry === null
        ? null
        : {
            lng: 10,
            lat: 45,
            confidence: 0.5,
            topCountries: [{ country: atlasCountry, p: 0.5 }],
            clues: [],
          },
  };
}

// Five European photos (Atlas reads each as European) and five Japanese ones, which Atlas
// reads as Asian, except j5, which it never guessed. Only two continents can fill a game, so
// every quad is three from one and one from the other.
const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", "FR")),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", "JP")),
  record("j5", "JP", null),
];

beforeEach(() => {
  localStorage.clear();
});

async function setup(random: () => number = () => 0) {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<OddOneOut deck={game.deck} loadRecords={loadRecords} random={random} />);
  await waitFor(() => expect(tap(1)).toBeEnabled(), { timeout: 5000 });
  return { loadRecords };
}

const tap = (n: number) => screen.getByRole("button", { name: `Photo ${n} is the odd one out` });
const streak = () => screen.getByText("Streak").nextElementSibling;
const shownIds = () =>
  [1, 2, 3, 4].map((n) => screen.getByTestId(`odd-photo-${n}`).getAttribute("data-photo")!);

/** The slot (1–4) holding the photo whose continent appears once. */
function oddSlot(): number {
  const ids = shownIds();
  const europe = ids.filter((id) => id.startsWith("e")).length;
  return ids.findIndex((id) => id.startsWith(europe === 1 ? "e" : "j")) + 1;
}

describe("OddOneOut", () => {
  it("deals four photos with no place until a tap, and loads the next four ahead", async () => {
    const { loadRecords } = await setup();
    const ids = shownIds();
    expect(new Set(ids).size).toBe(4);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.queryByText(/Place /)).toBeNull();
    // The quad on screen and the one after it (e2 with the three Asian photos again, since Asia
    // has no three fresh ones left), and nothing else.
    expect(new Set(loadRecords.mock.calls.flat(2))).toEqual(new Set([...ids, "e2"]));
  });

  it("reveals every photo's continent and Atlas's pick, then deals four more", async () => {
    // random() = 0 takes the first continent that can give three (Asia, before Europe), the
    // first fresh photos of each and puts the odd one first: e1, then j1, j2, j3.
    await setup();
    const before = shownIds();
    expect(before).toEqual(["e1", "j1", "j2", "j3"]);
    fireEvent.click(tap(1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Right");
    expect(card).toHaveTextContent("Photo 1 was taken in Europe; the other three in Asia.");
    expect(within(screen.getByTestId("odd-photo-1")).getByText("Europe")).toBeVisible();
    expect(within(screen.getByTestId("odd-photo-2")).getByText("Asia")).toBeVisible();
    expect(screen.getByTestId("odd-photo-2")).toHaveTextContent("Place j1");
    expect(card).toHaveTextContent(
      "Atlas read photo 1 as Europe and the rest as Asia, so it picked photo 1, and got it. Atlas this run: 1 of 1 quad.",
    );
    expect(within(screen.getByTestId("odd-photo-1")).getByText("Atlas's pick")).toBeVisible();
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_ODD_KEY)).toBe("1");

    fireEvent.click(within(card).getByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    expect(screen.queryByRole("region")).toBeNull();
    expect(shownIds()).not.toEqual(before);
  });

  it("ends the run on a wrong tap, made with the keyboard, and starts a new one", async () => {
    await setup(Math.random);
    const right = oddSlot();
    fireEvent.click(tap(right));
    fireEvent.click(await screen.findByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    const wrong = (oddSlot() % 4) + 1;
    fireEvent.keyDown(window, { key: String(wrong) });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 1 quad in a row. That's your new best!");
    expect(screen.getByTestId(`odd-photo-${wrong}`).className).toContain("border-flare");
    // Both rounds count in Atlas's record on your map, as one run.
    expect(loadFreeTallies()["odd-one-out"]).toMatchObject({ runs: 1, rounds: 2, right: 1 });

    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    expect(streak()).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("1");
  });

  it("says so when the deck has only one continent to deal from", async () => {
    const game = gameFor(RECORDS.slice(0, 5));
    render(<OddOneOut deck={game.deck} loadRecords={game.loadRecords} />);
    expect(await screen.findByRole("heading", { name: "No photos to play yet" })).toBeVisible();
  });
});

describe("OddOneOut, today's run", () => {
  const DAY = "2026-10-31";
  const now = () => new Date(`${DAY}T18:48:00Z`);

  function play() {
    const game = gameFor(RECORDS);
    return render(<OddOneOut deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
  }

  it("deals the day's quads, picks the run back up after a reload, and ends on a miss", async () => {
    const game = gameFor(RECORDS);
    const dealer = dailyOddDealer(game.deck.regions, DAY);
    const quads = [dealer.next()!, dealer.next()!];

    const first = play();
    await waitFor(() => expect(tap(1)).toBeEnabled(), { timeout: 5000 });
    expect(shownIds()).toEqual(quads[0].ids);
    expect(screen.getByText(/today's run \(2026-10-31\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    fireEvent.click(tap(quads[0].odd + 1));
    await screen.findByRole("button", { name: "Next four" });
    first.unmount();

    // A reload carries on at the next quad, with the streak so far: no fresh start.
    play();
    await waitFor(() => expect(tap(1)).toBeEnabled(), { timeout: 5000 });
    expect(shownIds()).toEqual(quads[1].ids);
    expect(streak()).toHaveTextContent("1");

    fireEvent.click(tap(((quads[1].odd + 1) % 4) + 1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Today's run is over: 1 quad in a row.");
    expect(within(card).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(card).getByRole("link", { name: "Play a free run" })).toHaveAttribute(
      "href",
      "/odd-one-out",
    );
    const kept = JSON.parse(localStorage.getItem(ODD_DAILY_KEY)!)[DAY];
    expect(kept).toMatchObject({ streak: 1, ended: "miss" });
    // Today's run keeps its own result, apart from the free runs' best.
    expect(localStorage.getItem(BEST_ODD_KEY)).toBeNull();
    // Today's runs are read from their own days; they never add to the free runs' record.
    expect(localStorage.getItem(QUICK_RECORD_KEY)).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(card).getByRole("button", { name: "Share today's run" }));
    expect(await within(card).findByText("Result copied. Paste it anywhere.")).toBeVisible();
    expect(writeText.mock.calls[0][0]).toMatch(
      /^Whereabout · Odd one out · 2026-10-31\n🧩 1 quad in a row\n🟩🟥\n/,
    );
  });

  it("shows the day's result instead of dealing it again once it has ended", async () => {
    localStorage.setItem(
      ODD_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: "miss" } }),
    );
    play();
    expect(await screen.findByRole("heading", { name: "3 quads in a row" })).toBeInTheDocument();
    expect(
      screen.getByText(/Atlas got 2 of the 3 quads it played\. The next run is dealt in 5h 12m\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /is the odd one out/ })).toBeNull();
  });

  it("links free runs and today's run to each other", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/odd-one-out/daily",
    );
  });
});

describe("a friend's Odd one out challenge", () => {
  // The friend spotted e1 among Japan's photos, then tapped photo 1 when j4 was the odd one.
  const FRIEND = "j1.e1.j2.j3-e2.e3.e4.j4_1_1";

  afterEach(() => window.history.replaceState(null, "", "/"));

  function clipboard() {
    const box = { sent: "" };
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (box.sent = t) },
      configurable: true,
    });
    return box;
  }

  async function linked(value: string) {
    window.history.replaceState(null, "", `/odd-one-out?challenge=${value}&x=1`);
    return setup(Math.random);
  }

  it("deals the friend's quads as laid out, shows their miss, plays on, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 1 quad in a row to beat")).toBeVisible();
    expect(shownIds()).toEqual(["j1", "e1", "j2", "j3"]);
    fireEvent.click(tap(2));
    let card = await screen.findByRole("region");
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    expect(screen.queryByText("Friend's pick")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());

    // The quad that ended the friend's run: they tapped photo 1.
    expect(shownIds()).toEqual(["e2", "e3", "e4", "j4"]);
    fireEvent.click(tap(4));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent("That beats your friend's 1 in a row!");
    expect(card).toHaveTextContent("Your friend's run ended here: they picked photo 1.");
    expect(within(screen.getByTestId("odd-photo-1")).getByText("Friend's pick")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());

    // Past the friend's quads, a fresh one; a wrong tap ends the run.
    const third = shownIds();
    const wrong = (oddSlot() % 4) + 1;
    fireEvent.click(tap(wrong));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      "Run over: 2 quads in a row. You beat your friend's 1 in a row by 1.",
    );
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_ODD_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these quads, laid out the same way.",
        ),
      ).toBeInTheDocument(),
    );
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Odd one out: I spotted the odd one in 2 quads in a row.",
      "That beats your 1. Your turn to go further.",
      `http://localhost:3000/odd-one-out?challenge=j1.e1.j2.j3-e2.e3.e4.j4-${third.join(".")}_2_${wrong}`,
    ]);

    // The head to head is drawn quad by quad, saved, and the reply link copied beside it.
    const drawn = stubCanvas();
    const reply = box.sent;
    box.sent = "";
    fireEvent.click(within(card).getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-odd-one-out-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining([
        "Odd one out: head to head",
        "You won",
        "2 in a row",
        "1 in a row",
        "Quad 1",
        "Quad 3",
        "Right",
        "Wrong",
      ]),
    );
    const all = drawn.words.join("\n");
    for (const id of ["j1", "e1", "j4", ...third]) expect(all).not.toContain(id);
    expect(all).not.toContain("Japan");
    expect(box.sent).toBe(reply);
    drawn.restore();

    // The answered challenge is kept once for the head to head on Your map, with the reply.
    expect(loadChallengeLog()).toEqual([
      expect.objectContaining({
        game: "Odd one out",
        outcome: "won",
        you: "2 in a row",
        friend: "1 in a row",
        link: expect.stringMatching(/^\/odd-one-out\?.*challenge=j1\.e1\.j2\.j3/),
        reply,
      }),
    ]);

    // A fresh run leaves the link behind.
    fireEvent.click(within(card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(screen.getByText(/^Odd one out: three photos share a continent/)).toBeInTheDocument(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when a link is cut short or its photos have gone, and deals a fresh run", async () => {
    await linked("j1.e1.j2_0_1");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(screen.getByText(/^Odd one out: three photos share a continent/)).toBeVisible();
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("j1.e1.j2.gone_0_1");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, carrying the quads up to the miss", async () => {
    await setup(Math.random);
    const ids = shownIds();
    const wrong = (oddSlot() % 4) + 1;
    fireEvent.click(tap(wrong));
    const card = await screen.findByRole("region");
    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent).toContain("I spotted the odd one in 0 quads in a row.");
    expect(within(card).queryByRole("button", { name: "Share head to head" })).toBeNull();
    expect(box.sent.split("\n").at(-1)).toBe(
      `http://localhost:3000/?challenge=${ids.join(".")}_0_${wrong}`,
    );
  });
});
