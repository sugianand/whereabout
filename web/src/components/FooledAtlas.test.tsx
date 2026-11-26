import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_FOOLED_KEY } from "@/lib/game/fooledAtlas";
import { FOOLED_DAILY_KEY, dailyFooledOrder } from "@/lib/game/fooledDaily";
import type { CatalogPhoto } from "@/lib/game/types";
import { stubCanvas } from "@/test/canvas";
import { gameFor } from "@/test/deck";

import FooledAtlas from "./FooledAtlas";

/** A photo at 0°, 0° that Atlas pinned `missDeg` degrees of latitude north of it. */
function record(id: string, missDeg: number | null, confidence = 0.5): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 0,
    lat: 0,
    place: `Place ${id}`,
    country: "GH",
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas:
      missDeg === null ? null : { lng: 0, lat: missDeg, confidence, topCountries: [], clues: [] },
  };
}

// random() = 0 shuffles with seed 0, which deals q5, q3, q4, q1, q2: Atlas missed photo 1 by
// more, then photo 2, then photo 1, then both by under 25 km (a dead heat).
const RECORDS = [
  record("q1", 0.1, 0.9),
  record("q2", 0.15, 0.8),
  record("q3", 1, 0.2),
  record("q4", 30, 0.3),
  record("q5", 40, 0.6),
];
const IDS = RECORDS.map((r) => r.photo.id);

beforeEach(() => {
  localStorage.clear();
});

async function setup(ids: readonly string[] = IDS) {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<FooledAtlas deck={game.deck} ids={ids} loadRecords={loadRecords} random={() => 0} />);
  return { loadRecords };
}

const pickButton = (n: number) => screen.getByRole("button", { name: `Photo ${n} fooled Atlas` });
const streak = () => screen.getByText("Streak").nextElementSibling;

describe("FooledAtlas", () => {
  it("deals the shuffled photos two at a time, with no miss shown until a pick", async () => {
    const { loadRecords } = await setup();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", "q5");
    expect(screen.getByTestId("fooled-photo-2")).toHaveAttribute("data-photo", "q3");
    expect(screen.queryByText(/Atlas off by/)).toBeNull();
    expect(screen.queryByText(/Place q/)).toBeNull();
    // Only the pair and the photo dealt next are fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(["q5", "q3", "q4"]);
  });

  it("reveals both misses and Atlas's own pick, then keeps the second photo", async () => {
    await setup();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    fireEvent.click(pickButton(1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Right");
    expect(card).toHaveTextContent(
      /Atlas missed Place q5 by 4,4\d\d km, but Place q3 by only 11\d km\./,
    );
    // Atlas was less sure of q3 (20% against 60%), so it picked it, and Atlas missed q5 by more.
    expect(card).toHaveTextContent(
      "Atlas was less sure of photo 2 (guessing, 20%), so it picked that one, wrong. Atlas this run: 0 of 1 pair.",
    );
    expect(screen.getByTestId("fooled-photo-1")).toHaveTextContent(/Place q5 · Atlas off by/);
    expect(within(screen.getByTestId("fooled-photo-1")).getByText("Fooled Atlas")).toBeVisible();
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_FOOLED_KEY)).toBe("1");

    expect(within(card).getByRole("button", { name: "Next pair" })).toHaveFocus();
    fireEvent.click(within(card).getByRole("button", { name: "Next pair" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", "q3");
    expect(screen.getByTestId("fooled-photo-2")).toHaveAttribute("data-photo", "q4");
  });

  it("ends the run on a wrong pick made by key, and starts a new one", async () => {
    await setup();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    fireEvent.click(pickButton(1));
    fireEvent.click(await screen.findByRole("button", { name: "Next pair" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    fireEvent.keyDown(window, { key: "1" });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 1 pair in a row. That's your new best!");
    // Atlas was less sure of q3 than q4 and Atlas missed q4 by more: its own pick was wrong.
    expect(card).toHaveTextContent("Atlas this run: 0 of 2 pairs.");

    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(streak()).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("1");
  });

  it("calls two near bullseyes a dead heat, either pick right", async () => {
    await setup(["q1", "q2"]);
    await waitFor(() => expect(pickButton(2)).toBeEnabled());
    fireEvent.click(pickButton(2));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Too close to call");
    expect(card).toHaveTextContent("Atlas came within 25 km of both, so either pick counts.");
    expect(streak()).toHaveTextContent("1");
  });

  it("says so when there are too few photos to deal", async () => {
    await setup(["q1"]);
    expect(await screen.findByRole("heading", { name: "No photos to play yet" })).toBeVisible();
  });
});

describe("FooledAtlas, today's run", () => {
  // Misses at least twice apart, so no pair is a dead heat whatever order the day deals.
  const MISSES: Record<string, number> = { d1: 1, d2: 3, d3: 9, d4: 27, d5: 81 };
  const DAILY = Object.entries(MISSES).map(([id, deg]) => record(id, deg, deg / 100));
  const DAY = "2026-11-26";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyFooledOrder(Object.keys(MISSES), DAY);
  /** The photo (1 or 2) Atlas really missed by more in the pair starting at `index`. */
  const fooled = (index: number) => (MISSES[order[index]] > MISSES[order[index + 1]] ? 1 : 2);

  function play() {
    const game = gameFor(DAILY);
    return render(
      <FooledAtlas
        deck={game.deck}
        ids={Object.keys(MISSES)}
        loadRecords={game.loadRecords}
        daily
        now={now}
      />,
    );
  }

  it("deals the day's order, picks the run back up after a reload, and ends on a miss", async () => {
    const first = play();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", order[0]);
    expect(screen.getByTestId("fooled-photo-2")).toHaveAttribute("data-photo", order[1]);
    expect(screen.getByText(/today's run \(2026-11-26\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free runs" })).toHaveAttribute(
      "href",
      "/fooled-atlas",
    );
    fireEvent.click(pickButton(fooled(0)));
    await screen.findByRole("button", { name: "Next pair" });
    first.unmount();

    // A reload carries on at the next pair, with the streak so far: no fresh start.
    play();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", order[1]);
    expect(screen.getByTestId("fooled-photo-2")).toHaveAttribute("data-photo", order[2]);
    expect(streak()).toHaveTextContent("1");

    fireEvent.click(pickButton(fooled(1) === 1 ? 2 : 1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Today's run is over: 1 pair in a row.");
    expect(within(card).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(card).getByRole("link", { name: "Play a free run" })).toHaveAttribute(
      "href",
      "/fooled-atlas",
    );
    // Sureness rises with the miss here, so Atlas's own pick (the less sure photo) is always
    // the one it missed by less: wrong on both pairs.
    expect(JSON.parse(localStorage.getItem(FOOLED_DAILY_KEY)!)).toEqual({
      [DAY]: { streak: 1, atlasRight: 0, atlasPlayed: 2, ended: "miss" },
    });
    // Today's run keeps its own result, apart from the free runs' best.
    expect(localStorage.getItem(BEST_FOOLED_KEY)).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(card).getByRole("button", { name: "Share today's run" }));
    expect(await within(card).findByText("Result copied. Paste it anywhere.")).toBeVisible();
    const shared = writeText.mock.calls[0][0] as string;
    expect(shared).toMatch(
      /^Whereabout · Which fooled Atlas\? · 2026-11-26\n🤖 1 pair in a row\n🟩🟥\nAtlas's own pick: 0 of 2\n/,
    );
    expect(shared).not.toMatch(/Place d/);
  });

  it("shows the day's result instead of dealing it again once it has ended", async () => {
    localStorage.setItem(
      FOOLED_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" } }),
    );
    play();
    expect(await screen.findByRole("heading", { name: "3 pairs in a row" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Atlas's own pick got 2 of the 4 pairs it played\. The next run is dealt in 5h 12m\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /fooled Atlas$/ })).toBeNull();
  });

  it("shows the day's result once every photo is called", async () => {
    // Four right of five photos leaves one pair: the last right pick clears the day.
    localStorage.setItem(
      FOOLED_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 3, atlasRight: 0, atlasPlayed: 3, ended: null } }),
    );
    play();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", order[3]);
    fireEvent.click(pickButton(fooled(3)));
    expect(JSON.parse(localStorage.getItem(FOOLED_DAILY_KEY)!)[DAY]).toEqual({
      streak: 4,
      atlasRight: 0,
      atlasPlayed: 4,
      ended: "cleared",
    });
  });

  it("links free runs to today's run", async () => {
    await setup();
    expect(await screen.findByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/fooled-atlas/daily",
    );
  });
});

describe("a friend's Which fooled Atlas? challenge", () => {
  // The friend called q5 over q3, then picked q3 (photo 1) when Atlas missed q4 by far more.
  const FRIEND = "q5.q3.q4_5_1";
  const shown = (n: number) => screen.getByTestId(`fooled-photo-${n}`).getAttribute("data-photo")!;

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
    window.history.replaceState(null, "", `/fooled-atlas?challenge=${value}&x=1`);
    await setup();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
  }

  it("deals the friend's chain, shows their pick where their run ended, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 1 pair in a row to beat")).toBeVisible();
    expect([shown(1), shown(2)]).toEqual(["q5", "q3"]);
    fireEvent.click(pickButton(1));
    let card = await screen.findByRole("region");
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    expect(screen.queryByText("Friend's pick")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Next pair" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());

    // The pair that ended the friend's run: they picked q3, the photo Atlas missed by less.
    expect([shown(1), shown(2)]).toEqual(["q3", "q4"]);
    fireEvent.click(pickButton(2));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent("That beats your friend's 1 in a row!");
    expect(card).toHaveTextContent("Your friend's run ended here: they picked photo 1.");
    expect(within(screen.getByTestId("fooled-photo-1")).getByText("Friend's pick")).toBeVisible();
    expect(within(screen.getByTestId("fooled-photo-2")).queryByText("Friend's pick")).toBeNull();

    // Past the friend's photos: Atlas missed q4 by thousands of km more than the next, so
    // picking the new photo is wrong and ends the run.
    fireEvent.click(within(card).getByRole("button", { name: "Next pair" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    const next = shown(2);
    expect(["q1", "q2"]).toContain(next);
    fireEvent.click(pickButton(2));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      "Run over: 2 pairs in a row. You beat your friend's 1 in a row by 1.",
    );
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_FOOLED_KEY)).toBeNull();
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("0");

    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these pairs, in the same order.",
        ),
      ).toBeInTheDocument(),
    );
    const lines = box.sent.split("\n");
    expect(lines[0]).toMatch(
      /^Whereabout · Which fooled Atlas\?: I called 2 pairs in a row\. Atlas's own pick: \d of 3 pairs\.$/,
    );
    expect(lines.slice(1)).toEqual([
      "That beats your 1. Your turn to read Atlas's misses.",
      `http://localhost:3000/fooled-atlas?challenge=q5.q3.q4.${next}_5_2`,
    ]);
    for (const r of RECORDS) expect(box.sent).not.toContain(r.photo.place);

    // The head to head is drawn pair by pair, saved, and the reply link copied beside it.
    const drawn = stubCanvas();
    const reply = box.sent;
    box.sent = "";
    fireEvent.click(within(card).getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-which-fooled-atlas-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining([
        "Which fooled Atlas?: head to head",
        "You won",
        "2 in a row",
        "1 in a row",
        "Pair 3",
        "Right",
        "Wrong",
      ]),
    );
    const all = drawn.words.join("\n");
    for (const r of RECORDS) {
      expect(all).not.toContain(r.photo.id);
      expect(all).not.toContain(r.photo.place);
    }
    expect(box.sent).toBe(reply);
    drawn.restore();

    // A fresh run leaves the link behind.
    fireEvent.click(within(card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(
        screen.getByText("Which fooled Atlas? Pick the photo Atlas placed further from home."),
      ).toBeVisible(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when a link is cut short or names photos Atlas didn't pin, and deals a fresh run", async () => {
    await linked("q5_5_0");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(
      screen.getByText("Which fooled Atlas? Pick the photo Atlas placed further from home."),
    ).toBeVisible();
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("q5.gone_5_0");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, carrying the photos up to the miss", async () => {
    await setup();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    // Seed 0 deals q5, q3: Atlas missed q5 by more, so picking q3 is wrong.
    fireEvent.click(pickButton(2));
    const card = await screen.findByRole("region");
    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent).toContain("I called 0 pairs in a row.");
    expect(box.sent).toContain("Same photos, same order: can you tell where Atlas got lost?");
    expect(box.sent.split("\n").at(-1)).toBe("http://localhost:3000/?challenge=q5.q3_0_0");
  });

  it("never offers a challenge from today's run", async () => {
    const game = gameFor(RECORDS);
    const now = () => new Date("2026-11-26T12:00:00Z");
    render(
      <FooledAtlas deck={game.deck} ids={IDS} loadRecords={game.loadRecords} daily now={now} />,
    );
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    const a = screen.getByTestId("fooled-photo-1").getAttribute("data-photo")!;
    const b = screen.getByTestId("fooled-photo-2").getAttribute("data-photo")!;
    const miss = Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.atlas!.lat]));
    // Pick the photo Atlas missed by less; if the pair is a dead heat, either is right.
    fireEvent.click(pickButton(miss[a] >= miss[b] ? 2 : 1));
    const card = await screen.findByRole("region");
    expect(within(card).queryByRole("button", { name: "Challenge a friend" })).toBeNull();
  });
});
