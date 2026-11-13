import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_LEFT_RIGHT_KEY, leftRightOrder, type SideMap } from "@/lib/game/leftRight";
import { EMPTY_TALLY, loadFreeTallies } from "@/lib/game/quickRecord";
import { SIDE_DAILY_KEY, dailySideOrder } from "@/lib/game/sideDaily";
import type { CatalogPhoto } from "@/lib/game/types";
import { stubCanvas } from "@/test/canvas";
import { atlasDrivingSide } from "@/lib/trueClues";
import { gameFor } from "@/test/deck";

import LeftRight from "./LeftRight";

function record(
  id: string,
  country: string,
  side: "left" | "right",
  atlas: GameRecord["atlas"],
): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 40,
    place: `Place ${id}`,
    country,
    drivingSide: side,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return { photo, atlas };
}

const guess = (clues: string[], top: string): GameRecord["atlas"] => ({
  lng: 0,
  lat: 0,
  confidence: 0.5,
  topCountries: [{ country: top, p: 0.5 }],
  clues: clues.map((label) => ({ label, p: 0.7 })),
});

const RECORDS = [
  record("j1", "JP", "left", guess(["Drives on the left"], "JP")),
  record("j2", "JP", "left", guess([], "KR")),
  record("f1", "FR", "right", guess([], "FR")),
  record("f2", "FR", "right", null),
  record("f3", "FR", "right", guess(["Drives on the left"], "GB")),
];
const SIDES: SideMap = Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.photo.drivingSide!]));
// random() = 0 deals from seed 0.
const ORDER = leftRightOrder(SIDES, 0);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));
const sideOf = (n: number) => byId.get(ORDER[n])!.photo.drivingSide!;
const other = (side: "left" | "right") => (side === "left" ? "right" : "left");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<LeftRight deck={game.deck} sides={SIDES} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(button("left")).toBeEnabled());
  return { loadRecords };
}

const button = (side: "left" | "right") =>
  screen.getByRole("button", {
    name: `${side === "left" ? "Left" : "Right"}: they drive on the ${side}`,
  });
const photo = () => screen.getByTestId("side-photo");
const streak = () => screen.getByText("Streak").nextElementSibling;

describe("LeftRight", () => {
  it("deals an even run, one photo at a time, with nothing about the place until a call", async () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(2);
    const { loadRecords } = await setup();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(screen.queryByText(/Place /)).toBeNull();
    expect(screen.queryByText(/Drives on the/)).toBeNull();
    // Only the photo on screen and the one dealt next are fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2));
  });

  it("reveals the country's side and Atlas's read, and plays on after a right call", async () => {
    await setup();
    const first = byId.get(ORDER[0])!;
    fireEvent.click(button(sideOf(0)));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
    const country = first.photo.country === "JP" ? "Japan" : "France";
    expect(card).toHaveTextContent(`In ${country} they drive on the ${sideOf(0)}.`);
    expect(card).toHaveTextContent(`Place ${ORDER[0]}`);
    expect(photo()).toHaveTextContent(`Drives on the ${sideOf(0)}`);
    if (first.atlas) expect(card).toHaveTextContent(/Atlas this run: [01] of 1 photo\./);
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBe("1");

    const next = within(card).getByRole("button", { name: "Next photo" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[1]));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("ends the run on a wrong call, says the best, and deals a new run", async () => {
    localStorage.setItem(BEST_LEFT_RIGHT_KEY, "4");
    await setup();
    fireEvent.click(button(other(sideOf(0))));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 0 photos in a row. Your best is 4 photos.");
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBe("4");
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(streak()).toHaveTextContent("0");
  });

  it("counts every free call in your clue reading, against Atlas where it read the road", async () => {
    await setup();
    fireEvent.click(button(sideOf(0)));
    let card = await screen.findByRole("region");
    expect(loadFreeTallies()["left-right"]).toMatchObject({ runs: 1, rounds: 1, right: 1 });
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[1]));
    fireEvent.click(button(other(sideOf(1))));
    card = await screen.findByRole("region");
    // Atlas is judged on the same photos, and only those it gave a read on.
    const reads = ORDER.slice(0, 2).map((id, n) => {
      const read = atlasDrivingSide(byId.get(id)!.atlas);
      return read && read.side === sideOf(n);
    });
    const played = reads.filter((r) => r !== null);
    expect(loadFreeTallies()["left-right"]).toEqual({
      runs: 1,
      rounds: 2,
      right: 1,
      atlasPlayed: played.length,
      atlasRight: played.filter(Boolean).length,
    });
    // The next run is counted as a new one.
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(button("left")).toBeEnabled());
    fireEvent.click(button(sideOf(0)));
    await screen.findByRole("region");
    expect(loadFreeTallies()["left-right"]).toMatchObject({ runs: 2, rounds: 3, right: 2 });
  });

  it("judges Atlas on what it read: its road clue first, else its top country", async () => {
    // A run with only f3 and j2: Atlas read "left" for the French photo from a clue, and picked
    // South Korea (right-hand traffic) for the Japanese one.
    const sides: SideMap = { f3: "right", j2: "left" };
    const game = gameFor(RECORDS);
    const order = leftRightOrder(sides, 0);
    render(
      <LeftRight deck={game.deck} sides={sides} loadRecords={game.loadRecords} random={() => 0} />,
    );
    await waitFor(() => expect(button("left")).toBeEnabled());
    fireEvent.click(button(sides[order[0]]));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      order[0] === "f3"
        ? "Atlas read the left from the photo: wrong."
        : "Atlas picked South Korea, where they drive on the right: wrong.",
    );
  });

  it("takes the call from the arrow keys", async () => {
    await setup();
    fireEvent.keyDown(window, { key: sideOf(0) === "left" ? "ArrowLeft" : "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Correct" })).toBeInTheDocument();
  });

  it("takes a swipe past the threshold as a call, and springs back from a short one", async () => {
    await setup();
    const el = photo();
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    const toward = sideOf(0) === "left" ? -1 : 1;
    // 400px wide: a call needs 100px. 60px is let go short and makes no call.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + toward * 60 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + toward * 60 });
    expect(screen.queryByRole("region")).toBeNull();
    expect(el.style.transform).toBe("");

    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 200 + toward * 130 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 200 + toward * 130 });
    expect(await screen.findByRole("heading", { name: "Correct" })).toBeInTheDocument();
  });

  it("says so when there are no photos from both sides to deal", async () => {
    const game = gameFor(RECORDS);
    render(<LeftRight deck={game.deck} sides={{ f1: "right" }} loadRecords={game.loadRecords} />);
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});

describe("LeftRight, today's run", () => {
  const DAY = "2026-11-13";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailySideOrder(SIDES, DAY);
  const daySide = (n: number) => byId.get(order[n])!.photo.drivingSide!;

  function play() {
    const game = gameFor(RECORDS);
    return render(
      <LeftRight deck={game.deck} sides={SIDES} loadRecords={game.loadRecords} daily now={now} />,
    );
  }

  it("deals the day's photos, picks the run back up after a reload, and ends on a miss", async () => {
    expect(order.length).toBeGreaterThanOrEqual(2);
    const first = play();
    await waitFor(() => expect(button("left")).toBeEnabled());
    expect(photo()).toHaveAttribute("data-photo", order[0]);
    expect(screen.getByText(/today's run \(2026-11-13\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free runs" })).toHaveAttribute("href", "/left-right");
    fireEvent.click(button(daySide(0)));
    await screen.findByRole("button", { name: "Next photo" });
    expect(JSON.parse(localStorage.getItem(SIDE_DAILY_KEY)!)[DAY]).toMatchObject({
      streak: 1,
      ended: null,
    });
    first.unmount();

    // A reload carries on at the next photo, with the streak so far: no fresh start.
    play();
    await waitFor(() => expect(button("left")).toBeEnabled());
    expect(photo()).toHaveAttribute("data-photo", order[1]);
    expect(streak()).toHaveTextContent("1");

    fireEvent.click(button(other(daySide(1))));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Today's run is over: 1 photo in a row.");
    expect(within(card).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(card).getByRole("link", { name: "Play a free run" })).toHaveAttribute(
      "href",
      "/left-right",
    );
    const kept = JSON.parse(localStorage.getItem(SIDE_DAILY_KEY)!)[DAY];
    expect(kept).toMatchObject({ streak: 1, ended: "miss" });
    // Today's run keeps its own result, apart from the free runs' best, and Your map reads it
    // from the day kept, so the free runs' clue reading never counts it a second time.
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBeNull();
    expect(loadFreeTallies()["left-right"]).toEqual(EMPTY_TALLY);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(card).getByRole("button", { name: "Share today's run" }));
    expect(await within(card).findByText("Result copied. Paste it anywhere.")).toBeVisible();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Whereabout · Left or right\? · 2026-11-13\n🛣️ 1 photo in a row\n🟩🟥\n/);
    // Counts only: no place, country or photo.
    for (const r of RECORDS) {
      expect(text).not.toContain(r.photo.id);
      expect(text).not.toContain(r.photo.place);
    }
  });

  it("shows the day's result instead of dealing it again once it has ended", async () => {
    localStorage.setItem(
      SIDE_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 4, atlasRight: 1, atlasPlayed: 3, ended: "miss" } }),
    );
    play();
    expect(await screen.findByRole("heading", { name: "4 photos in a row" })).toBeInTheDocument();
    expect(
      screen.getByText(/Atlas got 1 of the 3 photos it called\. The next run is dealt in 5h 12m\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.queryByTestId("side-left")).toBeNull();
  });

  it("calls every photo the day deals, then shows the day as cleared", async () => {
    play();
    for (let n = 0; n < order.length; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[n]));
      await waitFor(() => expect(button("left")).toBeEnabled());
      fireEvent.click(button(daySide(n)));
      fireEvent.click(await screen.findByRole("button", { name: "Next photo" }));
    }
    expect(
      await screen.findByRole("heading", { name: "You called every photo" }),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SIDE_DAILY_KEY)!)[DAY]).toMatchObject({
      streak: order.length,
      ended: "cleared",
    });
  });

  it("links the free runs to today's run", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/left-right/daily",
    );
  });
});

describe("a friend's Left or right? challenge", () => {
  // The friend called f1 and j1 right, then called f2 (right-hand traffic) left.
  const FRIEND = "f1.j1.f2_5_2";
  const shown = () => photo().getAttribute("data-photo")!;
  const truth = () => byId.get(shown())!.photo.drivingSide!;

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
    window.history.replaceState(null, "", `/left-right?challenge=${value}&x=1`);
    return setup();
  }

  async function callRight() {
    fireEvent.click(button(truth()));
    return screen.findByRole("region");
  }

  it("deals the friend's photos, shows the call that ended their run, plays on, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 2 photos in a row to beat")).toBeVisible();
    const run = [shown()];
    expect(run).toEqual(["f1"]);
    let card = await callRight();
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(button("left")).toBeEnabled());
    run.push(shown());
    card = await callRight();
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(button("left")).toBeEnabled());

    // The photo that ended the friend's run: nothing about it shows until the call is in.
    run.push(shown());
    expect(run).toEqual(["f1", "j1", "f2"]);
    expect(screen.queryByText(/Your friend's run ended here/)).toBeNull();
    card = await callRight();
    expect(card).toHaveTextContent("That beats your friend's 2 in a row!");
    expect(card).toHaveTextContent("Your friend's run ended here: they called left.");

    // Past the friend's photos, the photos left, dealt evenly: miss the next one.
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(button("left")).toBeEnabled());
    run.push(shown());
    expect(["j2", "f3"]).toContain(run[3]);
    fireEvent.click(button(other(truth())));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      "Run over: 3 photos in a row. You beat your friend's 2 in a row by 1.",
    );
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these photos, in the same order.",
        ),
      ).toBeInTheDocument(),
    );
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Left or right?: I called 3 photos in a row.",
      "That beats your 2. Your turn to read the road.",
      `http://localhost:3000/left-right?challenge=${run.join(".")}_5_3`,
    ]);

    // The head to head is drawn photo by photo, saved, and the reply link copied beside it.
    const drawn = stubCanvas();
    const reply = box.sent;
    box.sent = "";
    fireEvent.click(within(card).getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-left-or-right-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining([
        "Left or right?: head to head",
        "You won",
        "3 in a row",
        "2 in a row",
        "Photo 1",
        "Photo 4",
        "Right",
        "Wrong",
      ]),
    );
    const all = drawn.words.join("\n");
    for (const id of run) expect(all).not.toContain(id);
    expect(box.sent).toBe(reply);
    drawn.restore();

    // A fresh run leaves the link behind.
    fireEvent.click(within(card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(
        screen.getByText("Left or right? Which side of the road do they drive on here?"),
      ).toBeVisible(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when a link is cut short or its photos have gone, and deals a fresh run", async () => {
    await linked("f1.j1_5_0");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(
      screen.getByText("Left or right? Which side of the road do they drive on here?"),
    ).toBeVisible();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("f1.gone_5_1");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, carrying the photos up to the miss", async () => {
    await setup();
    fireEvent.click(button(other(sideOf(0))));
    const card = await screen.findByRole("region");
    expect(within(card).queryByRole("button", { name: "Share head to head" })).toBeNull();
    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Left or right?: I called 0 photos in a row.",
      "Same photos, same order: which side do they drive on?",
      `http://localhost:3000/?challenge=${ORDER[0]}_0_0`,
    ]);
  });

  it("offers a challenge from a cleared run, naming every photo with no miss", async () => {
    await setup();
    for (let n = 0; n < ORDER.length; n++) {
      fireEvent.click(button(sideOf(n)));
      const card = await screen.findByRole("region");
      fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
      if (n < ORDER.length - 1) await waitFor(() => expect(button("left")).toBeEnabled());
    }
    await screen.findByRole("heading", { name: "You called every photo" });
    const box = clipboard();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent.split("\n").at(-1)).toBe(
      `http://localhost:3000/?challenge=${ORDER.join(".")}_0_${ORDER.length}`,
    );
  });

  it("never offers a challenge from today's run", async () => {
    const game = gameFor(RECORDS);
    const now = () => new Date("2026-11-13T12:00:00Z");
    render(
      <LeftRight deck={game.deck} sides={SIDES} loadRecords={game.loadRecords} daily now={now} />,
    );
    await waitFor(() => expect(button("left")).toBeEnabled());
    fireEvent.click(button(other(truth())));
    await screen.findByRole("region");
    expect(screen.queryByRole("button", { name: "Challenge a friend" })).toBeNull();
  });
});
