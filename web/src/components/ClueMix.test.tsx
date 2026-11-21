import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLUE_DAILY_KEY, dailyClueOrder, rememberClueDay } from "@/lib/game/clueDaily";
import {
  BEST_CLUE_MIX_KEY,
  atlasClueRead,
  clueAnswers,
  clueTruth,
  dealClueMix,
  type ClueKind,
  type ClueMaps,
  type ClueStep,
} from "@/lib/game/clueMix";
import type { GameRecord } from "@/lib/game/deck";
import { EMPTY_TALLY, loadFreeTallies, loadQuickRecord } from "@/lib/game/quickRecord";
import type { CatalogPhoto } from "@/lib/game/types";
import type { ClimateGroup } from "@/lib/trueClues";
import { stubCanvas } from "@/test/canvas";
import { gameFor } from "@/test/deck";

import ClueMix from "./ClueMix";

function record(
  id: string,
  country: string,
  side: "left" | "right",
  climate: ClimateGroup,
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
    climateGroup: climate,
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
  record("j1", "JP", "left", "Temperate", guess(["Drives on the left", "Arid climate"], "JP")),
  record("j2", "JP", "left", "Continental", guess([], "KR")),
  record("g1", "GB", "left", "Temperate", guess(["Temperate climate", "City"], "GB")),
  record("f1", "FR", "right", "Temperate", guess([], "FR")),
  record("f2", "FR", "right", "Arid", null),
  record("e1", "EG", "right", "Arid", guess(["Arid climate"], "MA")),
  record("b1", "BR", "right", "Tropical", guess(["Drives on the left"], "PT")),
  record("a1", "AU", "left", "Arid", guess([], "AU")),
  record("n1", "NO", "right", "Polar", guess(["Arctic"], "NO")),
];
const MAPS: ClueMaps = {
  sides: Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.photo.drivingSide!])),
  climates: Object.fromEntries(
    RECORDS.map((r) => [r.photo.id, r.photo.climateGroup as ClimateGroup]),
  ),
  continents: {
    j1: "Asia",
    j2: "Asia",
    g1: "Europe",
    f1: "Europe",
    f2: "Europe",
    e1: "Africa",
    b1: "South America",
    a1: "Oceania",
    n1: "Europe",
  },
  grounds: {
    j1: "Built-up",
    j2: "Tree cover",
    g1: "Grassland",
    f1: "Built-up",
    f2: "Permanent water bodies",
    e1: "Bare / sparse vegetation",
    b1: "Tree cover",
    a1: "Bare / sparse vegetation",
    n1: "Grassland",
  },
};
// random() = 0 deals from seed 0.
const ORDER = dealClueMix(MAPS, 0);
const truthOf = (n: number) => clueTruth(ORDER[n].clue, ORDER[n].id, MAPS)!;

/** Atlas's call on a step as Your clue reading keeps it: right, wrong, or no read. */
function atlasCall({ id, clue }: ClueStep): boolean | null {
  const read = atlasClueRead(clue, RECORDS.find((r) => r.photo.id === id)!.atlas);
  return read === null ? null : read === clueTruth(clue, id, MAPS);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<ClueMix deck={game.deck} maps={MAPS} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(screen.getByTestId("clue-left")).toBeEnabled());
  // The keys are listened for in an effect, which a slow machine may not have run yet when the
  // buttons are first enabled; flush it so a key pressed next is heard.
  await act(async () => {});
  return { loadRecords };
}

const photo = () => screen.getByTestId("clue-photo");
const streak = () => screen.getByText("Streak").nextElementSibling;

/** Answer the step on screen right, then move on. */
async function callRight(n: number) {
  await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n].id));
  await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(n)}`)).toBeEnabled());
  fireEvent.click(screen.getByTestId(`clue-${truthOf(n)}`));
  const card = await screen.findByRole("region");
  expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
  fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
}

describe("ClueMix", () => {
  it("asks the road first, with nothing about the place until a call", async () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(3);
    const { loadRecords } = await setup();
    expect(ORDER[0].clue).toBe("road");
    expect(photo()).toHaveAttribute("data-photo", ORDER[0].id);
    expect(photo()).toHaveAttribute("data-clue", "road");
    expect(screen.getByTestId("clue-question")).toHaveTextContent(
      "Which side of the road do they drive on?",
    );
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Road");
    expect(screen.queryByText(/Place /)).toBeNull();
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2).map((s) => s.id));
  });

  it("moves through the climate and the continent, revealing each answer and Atlas's read", async () => {
    await setup();
    await callRight(0);

    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "climate"));
    expect(screen.getByTestId("clue-question")).toHaveTextContent("Which climate is it?");
    expect(screen.getByRole("group").querySelectorAll("button")).toHaveLength(5);
    await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(1)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truthOf(1)}`));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent(`${truthOf(1).toLowerCase()} climate, in`);
    expect(card).toHaveTextContent(/Atlas this run: [0-2] of [0-2]\./);
    expect(card).toHaveTextContent("Next up: the continent");
    expect(photo()).toHaveTextContent(truthOf(1));
    expect(streak()).toHaveTextContent("2");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));

    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "continent"));
    expect(screen.getByTestId("clue-question")).toHaveTextContent("Which continent is it on?");
    // Only the continents the deck holds.
    expect(screen.getByRole("group").querySelectorAll("button")).toHaveLength(
      clueAnswers("continent", MAPS).length,
    );
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBe("2");
  });

  it("asks the ground fourth, with five covers, Atlas's read and the road next", async () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(5);
    await setup();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Road",
      "Climate",
      "Continent",
      "Ground",
    ]);
    await callRight(0);
    await callRight(1);
    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "continent"));
    await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(2)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truthOf(2)}`));
    let card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Next up: the ground");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));

    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "ground"));
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Ground");
    expect(screen.getByTestId("clue-question")).toHaveTextContent(
      "What covers the ground around it?",
    );
    const buttons = screen.getByRole("group").querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual([
      "Built-up",
      "Trees",
      "Grassland",
      "Water",
      "Bare ground",
    ]);
    // 1 to 5 name a cover by its place in the row.
    await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(3)}`)).toBeEnabled());
    const n =
      [
        "Built-up",
        "Tree cover",
        "Grassland",
        "Permanent water bodies",
        "Bare / sparse vegetation",
      ].indexOf(truthOf(3)) + 1;
    fireEvent.keyDown(window, { key: String(n) });
    card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
    expect(card).toHaveTextContent(/Mostly .+ around it, in /);
    expect(card).toHaveTextContent(/Atlas (read the ground as|said nothing about the ground)/);
    expect(card).toHaveTextContent("Next up: the road");
    expect(streak()).toHaveTextContent("4");
  });

  it("counts each call in your clue reading under its clue, the first of each a new run", async () => {
    await setup();
    await callRight(0);
    await callRight(1);
    await callRight(2);
    await callRight(3);
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[4].id));
    const free = loadFreeTallies();
    for (const n of [0, 1, 2, 3]) {
      const atlas = atlasCall(ORDER[n]);
      expect(free[`clue-mix-${ORDER[n].clue}`]).toEqual({
        runs: 1,
        rounds: 1,
        right: 1,
        atlasPlayed: atlas === null ? 0 : 1,
        atlasRight: atlas ? 1 : 0,
      });
    }
    // The single-clue games' own tallies are left alone.
    expect(free["left-right"]).toEqual(EMPTY_TALLY);
    expect(free["which-climate"]).toEqual(EMPTY_TALLY);

    // The fifth step asks the road again, in the same run.
    await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(4)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truthOf(4)}`));
    await screen.findByRole("region");
    expect(loadFreeTallies()["clue-mix-road"]).toMatchObject({ runs: 1, rounds: 2, right: 2 });
  });

  it("takes the arrows for the road and numbers for the rest", async () => {
    await setup();
    fireEvent.keyDown(window, { key: truthOf(0) === "left" ? "ArrowLeft" : "ArrowRight" });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "climate"));
    await waitFor(() => expect(screen.getByTestId("clue-Tropical")).toBeEnabled());
    // An arrow names no climate.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.queryByRole("region")).toBeNull();
    const n = ["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(truthOf(1)) + 1;
    fireEvent.keyDown(window, { key: String(n) });
    expect(within(await screen.findByRole("region")).getByRole("heading")).toHaveTextContent(
      "Correct",
    );
  });

  it("ends the run on a wrong call, says the best, and deals a new run", async () => {
    localStorage.setItem(BEST_CLUE_MIX_KEY, "4");
    await setup();
    fireEvent.click(screen.getByTestId(`clue-${truthOf(0) === "left" ? "right" : "left"}`));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 0 clues in a row. Your best is 4 clues.");
    expect(card).not.toHaveTextContent("Next up");
    const again = within(card).getByRole("button", { name: "Start a new run" });
    expect(again).toHaveFocus();
    fireEvent.click(again);
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(streak()).toHaveTextContent("0");
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBe("4");
  });

  it("says when there's nothing to deal", async () => {
    const game = gameFor(RECORDS);
    render(
      <ClueMix
        deck={game.deck}
        maps={{ sides: { j1: "left" }, climates: {}, continents: {}, grounds: {} }}
        loadRecords={game.loadRecords}
        random={() => 0}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});

describe("today's Clue mix", () => {
  const DAY = "2026-11-15";
  const now = () => new Date(`${DAY}T09:00:00Z`);
  const TODAY = dailyClueOrder(MAPS, DAY);
  const todayTruth = (n: number) => clueTruth(TODAY[n].clue, TODAY[n].id, MAPS)!;
  const wrongFor = (n: number) =>
    clueAnswers(TODAY[n].clue, MAPS).find((a) => a !== todayTruth(n))!;

  function daily() {
    const game = gameFor(RECORDS);
    return render(
      <ClueMix
        deck={game.deck}
        maps={MAPS}
        loadRecords={game.loadRecords}
        random={() => 0.5}
        daily
        now={now}
      />,
    );
  }

  it("deals the day's steps whatever the randomness, with no best and a way to free runs", async () => {
    expect(TODAY.length).toBeGreaterThanOrEqual(2);
    daily();
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", TODAY[0].id));
    expect(screen.getByText(`Clue mix, today's run (${DAY}).`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free runs" })).toHaveAttribute("href", "/clue-mix");
    expect(screen.queryByText("Best")).toBeNull();
  });

  it("keeps the run after each call, so a reload goes on from the next step", async () => {
    const first = daily();
    await waitFor(() => expect(screen.getByTestId(`clue-${todayTruth(0)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${todayTruth(0)}`));
    await screen.findByRole("region");
    expect(JSON.parse(localStorage.getItem(CLUE_DAILY_KEY)!)[DAY]).toMatchObject({
      streak: 1,
      ended: null,
    });
    first.unmount();

    daily();
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", TODAY[1].id));
    expect(photo()).toHaveAttribute("data-clue", TODAY[1].clue);
    expect(streak()).toHaveTextContent("1");
    // The free runs' best is its own.
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBeNull();
  });

  it("keeps Atlas's call on each step with the day, for Your clue reading, and no free tally", async () => {
    const first = daily();
    await waitFor(() => expect(screen.getByTestId(`clue-${todayTruth(0)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${todayTruth(0)}`));
    fireEvent.click(
      within(await screen.findByRole("region")).getByRole("button", { name: "Next photo" }),
    );
    first.unmount();

    // After a reload, the next call adds to the reads kept.
    daily();
    await waitFor(() => expect(screen.getByTestId(`clue-${wrongFor(1)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${wrongFor(1)}`));
    await screen.findByRole("region");
    const mark = (n: number) => {
      const call = atlasCall(TODAY[n]);
      return call === null ? "-" : call ? "r" : "w";
    };
    expect(JSON.parse(localStorage.getItem(CLUE_DAILY_KEY)!)[DAY]).toMatchObject({
      streak: 1,
      ended: "miss",
      reads: mark(0) + mark(1),
    });
    expect(Object.values(loadFreeTallies())).toEqual(
      Object.values(loadFreeTallies()).map(() => EMPTY_TALLY),
    );
    const record = loadQuickRecord();
    expect(record[`clue-mix-${TODAY[0].clue}`].daily).toMatchObject({ rounds: 1, right: 1 });
    expect(record[`clue-mix-${TODAY[1].clue}`].daily).toMatchObject({ rounds: 1, right: 0 });
  });

  it("ends the day on a miss with a share in place of a new run, then shows the day's result", async () => {
    const first = daily();
    await waitFor(() => expect(screen.getByTestId(`clue-${wrongFor(0)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${wrongFor(0)}`));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Today's run is over: 0 clues in a row, out on the road.");
    expect(within(card).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(CLUE_DAILY_KEY)!)[DAY].ended).toBe("miss");
    first.unmount();

    daily();
    expect(await screen.findByRole("heading", { name: "0 clues in a row" })).toBeInTheDocument();
    expect(screen.getByText(/out on the road\..*The next run is dealt in/)).toBeInTheDocument();
    expect(screen.queryByTestId("clue-photo")).toBeNull();
  });

  it("asks three clues on a day before the ground joined, four from the day it did", async () => {
    const first = daily();
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", TODAY[0].id));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Road",
      "Climate",
      "Continent",
    ]);
    first.unmount();

    const game = gameFor(RECORDS);
    const later = "2026-11-18";
    render(
      <ClueMix
        deck={game.deck}
        maps={MAPS}
        loadRecords={game.loadRecords}
        daily
        now={() => new Date(`${later}T09:00:00Z`)}
      />,
    );
    await waitFor(() =>
      expect(photo()).toHaveAttribute("data-photo", dailyClueOrder(MAPS, later)[0].id),
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Road",
      "Climate",
      "Continent",
      "Ground",
    ]);
  });

  it("shows a day kept as cleared without dealing it again", async () => {
    rememberClueDay(DAY, { streak: 7, atlasRight: 3, atlasPlayed: 5, ended: "cleared" });
    daily();
    expect(await screen.findByRole("heading", { name: "You read every clue" })).toBeInTheDocument();
    expect(screen.getByText(/Atlas got 3 of the 5 clues it called\./)).toBeInTheDocument();
  });
});

describe("a friend's Clue mix challenge", () => {
  // The friend read f1's road (right) and e1's climate (arid), then put j1 in Europe: it's Asia.
  // Sent before the ground joined, so it is played over the three clues it was dealt.
  const FRIEND = "f1.e1.j1_5_2_eu";
  const shown = () => photo().getAttribute("data-photo")!;
  const clueShown = () => photo().getAttribute("data-clue")!;
  const truth = () => clueTruth(clueShown() as ClueKind, shown(), MAPS)!;

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
    window.history.replaceState(null, "", `/clue-mix?challenge=${value}&x=1`);
    const game = gameFor(RECORDS);
    render(
      <ClueMix deck={game.deck} maps={MAPS} loadRecords={game.loadRecords} random={() => 0} />,
    );
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo"));
  }

  async function callRight() {
    await waitFor(() => expect(screen.getByTestId(`clue-${truth()}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truth()}`));
    return screen.findByRole("region");
  }

  async function next(card: HTMLElement) {
    const before = shown();
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(shown()).not.toBe(before));
  }

  it("deals the friend's steps, shows the answer that ended their run, plays on, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 2 clues in a row to beat")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const run = [shown()];
    expect([run[0], clueShown()]).toEqual(["f1", "road"]);
    let card = await callRight();
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    await next(card);
    run.push(shown());
    expect(clueShown()).toBe("climate");
    card = await callRight();
    await next(card);

    // The step that ended the friend's run: nothing of their answer shows until the call is in.
    run.push(shown());
    expect(run).toEqual(["f1", "e1", "j1"]);
    expect(clueShown()).toBe("continent");
    expect(screen.queryByText(/Your friend's run ended here/)).toBeNull();
    card = await callRight();
    expect(card).toHaveTextContent("That beats your friend's 2 in a row!");
    expect(card).toHaveTextContent("Your friend's run ended here: they said Europe.");

    // Past the friend's steps, the cycle goes on with photos not yet shown: miss the road.
    await next(card);
    run.push(shown());
    expect(clueShown()).toBe("road");
    expect(run.slice(0, 3)).not.toContain(run[3]);
    const wrong = truth() === "left" ? "right" : "left";
    await waitFor(() => expect(screen.getByTestId(`clue-${wrong}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${wrong}`));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      "Run over: 3 clues in a row. You beat your friend's 2 in a row by 1.",
    );
    expect(card).not.toHaveTextContent("Your friend's run ended here");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these photos, asking the same clues.",
        ),
      ).toBeInTheDocument(),
    );
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Clue mix: I read 3 clues in a row.",
      "That beats your 2. Your turn to read the clues.",
      `http://localhost:3000/clue-mix?challenge=${run.join(".")}_5_3_${wrong[0]}`,
    ]);

    // The head to head is drawn clue by clue, with no photo in it.
    const drawn = stubCanvas();
    fireEvent.click(within(card).getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-clue-mix-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining(["Clue mix: head to head", "You won", "Clue 1", "Clue 4"]),
    );
    const all = drawn.words.join("\n");
    for (const id of run) expect(all).not.toContain(id);
    expect(all).not.toMatch(/Europe|Asia/);
    drawn.restore();

    // A fresh run leaves the link behind.
    fireEvent.click(within(card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() => expect(screen.getByText("Clue mix: a new clue each photo.")).toBeVisible());
    expect(window.location.search).toBe("?x=1");
  });

  it("plays a four-clue link on to the ground past the friend's miss", async () => {
    await linked(`4_${FRIEND}`);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    for (let i = 0; i < 3; i++) await next(await callRight());
    expect(clueShown()).toBe("ground");
    expect(["f1", "e1", "j1"]).not.toContain(shown());
  });

  it("says when a link is cut short or its photos have gone, and deals a fresh run", async () => {
    // The friend's "miss" on j1 named its own continent: no miss at all.
    await linked("f1.e1.j1_5_2_as");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(screen.getByText("Clue mix: a new clue each photo.")).toBeVisible();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0].id);
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("f1.gone_5_1_A");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, with the answer that ended it", async () => {
    await setup();
    const wrong = truthOf(0) === "left" ? "right" : "left";
    fireEvent.click(screen.getByTestId(`clue-${wrong}`));
    const card = await screen.findByRole("region");
    expect(within(card).queryByRole("button", { name: "Share head to head" })).toBeNull();
    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Clue mix: I read 0 clues in a row.",
      "Same photos, same clues: the road, the climate, the continent, the ground, in turn.",
      `http://localhost:3000/?challenge=4_${ORDER[0].id}_0_0_${wrong[0]}`,
    ]);
  });

  it("never offers a challenge from today's run", async () => {
    const game = gameFor(RECORDS);
    const now = () => new Date("2026-11-15T12:00:00Z");
    render(<ClueMix deck={game.deck} maps={MAPS} loadRecords={game.loadRecords} daily now={now} />);
    await waitFor(() => expect(screen.getByTestId("clue-left")).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truth() === "left" ? "right" : "left"}`));
    await screen.findByRole("region");
    expect(screen.queryByRole("button", { name: "Challenge a friend" })).toBeNull();
  });
});
