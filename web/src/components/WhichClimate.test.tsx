import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { CLIMATE_DAILY_KEY, dailyClimateOrder } from "@/lib/game/climateDaily";
import {
  BEST_CLIMATE_MIX_UPS_KEY,
  CLIMATE_CALLS_KEY,
  loadClimateCalls,
  practiceMap,
} from "@/lib/game/climateMixUps";
import { EMPTY_TALLY, loadFreeTallies, loadQuickRecord } from "@/lib/game/quickRecord";
import { BEST_CLIMATE_KEY, dealClimate, type ClimateMap } from "@/lib/game/whichClimate";
import { atlasClimateGroup, type ClimateGroup } from "@/lib/trueClues";
import { stubCanvas } from "@/test/canvas";
import { gameFor } from "@/test/deck";

import WhichClimate from "./WhichClimate";

function record(id: string, group: ClimateGroup, atlasClues: string[] | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: -33.5,
    place: `Place ${id}`,
    country: "AU",
    climateGroup: group,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  const atlas = atlasClues && {
    lng: 0,
    lat: 0,
    confidence: 0.5,
    topCountries: [{ country: "AU", p: 0.5 }],
    clues: atlasClues.map((label) => ({ label, p: 0.7 })),
  };
  return { photo, atlas };
}

// Each photo's Atlas read is right, wrong or missing, depending on the photo.
const RECORDS = [
  record("t1", "Tropical", ["Tropical climate"]),
  record("t2", "Tropical", ["Desert"]),
  record("a1", "Arid", ["Arid climate"]),
  record("a2", "Arid", null),
  record("m1", "Temperate", ["Mediterranean"]),
  record("m2", "Temperate", ["City"]),
  record("c1", "Continental", ["Temperate climate"]),
  record("p1", "Polar", ["Arctic"]),
];
const GROUPS: ClimateMap = Object.fromEntries(
  RECORDS.map((r) => [r.photo.id, r.photo.climateGroup as ClimateGroup]),
);
// random() = 0 deals from seed 0.
const ORDER = dealClimate(GROUPS, 0);
const truthOf = (n: number) => GROUPS[ORDER[n]];
const wrongFor = (g: ClimateGroup): ClimateGroup => (g === "Polar" ? "Arid" : "Polar");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(
    <WhichClimate deck={game.deck} groups={GROUPS} loadRecords={loadRecords} random={() => 0} />,
  );
  await waitFor(() => expect(button("Arid")).toBeEnabled());
  return { loadRecords };
}

const button = (group: ClimateGroup) => screen.getByTestId(`climate-${group}`);
const photo = () => screen.getByTestId("climate-photo");
const score = () => screen.getByText("Score").nextElementSibling;

describe("WhichClimate", () => {
  it("deals five photos, showing nothing about the place before a call", async () => {
    expect(ORDER).toHaveLength(5);
    const { loadRecords } = await setup();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(screen.getByText("Photo 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText(/Place /)).toBeNull();
    // The photo on screen and the next one are all that's fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2));
  });

  it("reveals the place on the band of climates, with your call and Atlas's", async () => {
    await setup();
    const truth = truthOf(0);
    const wrong = wrongFor(truth);
    fireEvent.click(button(wrong));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent(`climate:`);
    expect(card).toHaveTextContent(`Place ${ORDER[0]} · 33.5° S`);
    const band = within(card).getByTestId("climate-band");
    const here = band.querySelector("[aria-current='location']")!;
    expect(here).toHaveAttribute("data-group", truth);
    expect(band.querySelector(`[data-group='${wrong}']`)).toHaveTextContent("You");
    expect(score()).toHaveTextContent("0");
    // The next button has focus, so Enter moves on.
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("plays five photos by key, against Atlas, and keeps the best whole game", async () => {
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n]));
      await waitFor(() => expect(button("Arid")).toBeEnabled());
      const pick = n < 3 ? truthOf(n) : wrongFor(truthOf(n));
      const key = String(
        ["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(pick) + 1,
      );
      fireEvent.keyDown(window, { key });
      const card = await screen.findByRole("region");
      expect(within(card).getByRole("heading")).toHaveTextContent(n < 3 ? "Correct" : "Wrong");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "3 of 5" })).toBeInTheDocument();
    expect(screen.getAllByTestId("climate-row")).toHaveLength(5);
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBe("3");
    expect(screen.getByText(/Atlas read the climate on \d of the 5 photos/)).toBeInTheDocument();
    // Every call is in your clue reading on Your map, with Atlas's read of the same photos.
    const reads = ORDER.map((id) =>
      atlasClimateGroup(RECORDS.find((r) => r.photo.id === id)!.atlas),
    );
    expect(loadFreeTallies()["which-climate"]).toEqual({
      runs: 1,
      rounds: 5,
      right: 3,
      atlasPlayed: reads.filter((g) => g !== null).length,
      atlasRight: reads.filter((g, n) => g !== null && g === truthOf(n)).length,
    });
    // And which climate was called for which, for your climate mix-ups.
    expect(loadClimateCalls()).toEqual(
      ORDER.map((_, n) => ({
        truth: truthOf(n),
        picked: n < 3 ? truthOf(n) : wrongFor(truthOf(n)),
      })),
    );
  });

  it("says when Atlas read nothing about the climate", async () => {
    // Deal a game whose first photo is the one Atlas sat out.
    const groups: ClimateMap = {
      a2: "Arid",
      t1: "Tropical",
      m1: "Temperate",
      c1: "Continental",
      p1: "Polar",
    };
    const game = gameFor(RECORDS);
    let seed = 0;
    while (dealClimate(groups, seed)[0] !== "a2") seed++;
    render(
      <WhichClimate
        deck={game.deck}
        groups={groups}
        loadRecords={game.loadRecords}
        random={() => seed / 2 ** 32}
      />,
    );
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    fireEvent.click(button("Arid"));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Atlas said nothing about the climate here");
    expect(card).toHaveTextContent("Atlas this game: 0 of 1.");
  });

  it("says so when there are too few photos to deal", async () => {
    const game = gameFor(RECORDS);
    render(
      <WhichClimate deck={game.deck} groups={{ a1: "Arid" }} loadRecords={game.loadRecords} />,
    );
    expect(await screen.findByText("No photos to play yet")).toBeInTheDocument();
  });
});

describe("WhichClimate, today's game", () => {
  const DAY = "2026-11-13";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyClimateOrder(GROUPS, DAY);
  const dayTruth = (n: number) => GROUPS[order[n]];

  function play() {
    const game = gameFor(RECORDS);
    return render(
      <WhichClimate
        deck={game.deck}
        groups={GROUPS}
        loadRecords={game.loadRecords}
        daily
        now={now}
      />,
    );
  }

  async function call(n: number, group: ClimateGroup) {
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[n]));
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    fireEvent.click(button(group));
    return screen.findByRole("region");
  }

  it("deals the day's photos, picks up after a reload, and shares the score once all five are called", async () => {
    expect(order).toHaveLength(5);
    const first = play();
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    expect(screen.getByText(/today's game \(2026-11-13\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    await call(0, dayTruth(0));
    expect(JSON.parse(localStorage.getItem(CLIMATE_DAILY_KEY)!)[DAY].results).toHaveLength(1);
    first.unmount();

    // A reload carries on at the second photo with the score so far: the first can't be retaken.
    play();
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[1]));
    expect(score()).toHaveTextContent("1");
    expect(screen.getByText("Photo 2 of 5")).toBeInTheDocument();

    for (let n = 1; n < 5; n++) {
      const card = await call(n, n < 3 ? dayTruth(n) : wrongFor(dayTruth(n)));
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See today's result" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "3 of 5" })).toBeInTheDocument();
    expect(screen.getByText(/^That's today's game played\./)).toBeInTheDocument();
    expect(screen.getByText(/The next game is dealt in 5h 12m\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("climate-row")[0]).toHaveTextContent("Place"));
    expect(screen.getAllByTestId("climate-row")).toHaveLength(5);

    // Today's game keeps its own result, apart from the free games' best, and Your map reads it
    // from the day kept, so the free games' tally never counts it a second time.
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBeNull();
    expect(loadFreeTallies()["which-climate"]).toEqual(EMPTY_TALLY);
    expect(loadClimateCalls()).toEqual([]);
    expect(loadQuickRecord()["which-climate"].daily).toMatchObject({
      runs: 1,
      rounds: 5,
      right: 3,
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = screen.getByRole("button", { name: "Share today's game" });
    expect(share).toHaveFocus();
    fireEvent.click(share);
    expect(await screen.findByText("Result copied. Paste it anywhere.")).toBeVisible();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Whereabout · Which climate\? · 2026-11-13\n🌦️ 3 of 5\n🟩🟩🟩🟥🟥\n/);
    for (const r of RECORDS) {
      expect(text).not.toContain(r.photo.id);
      expect(text).not.toContain(r.photo.place);
    }
  });

  it("shows the day's result instead of dealing it again once every photo is called", async () => {
    const results = order.map((id) => ({
      id,
      picked: GROUPS[id],
      truth: GROUPS[id],
      correct: true,
      atlas: null,
    }));
    localStorage.setItem(CLIMATE_DAILY_KEY, JSON.stringify({ [DAY]: { results } }));
    play();
    expect(await screen.findByRole("heading", { level: 1, name: "5 of 5" })).toBeInTheDocument();
    expect(screen.getByText(/Atlas said nothing about the climate today\./)).toBeInTheDocument();
    expect(screen.queryByTestId("climate-photo")).toBeNull();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
  });

  it("links the free games to today's game", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/which-climate/daily",
    );
  });
});

describe("a friend's Which climate? challenge", () => {
  // The friend's five, in their order, with t1, a1 and p1 named right and m1 and c1 wrong: 3 of 5.
  const IDS = ["t1", "m1", "a1", "c1", "p1"];
  const FRIEND = "t1.m1.a1.c1.p1_ABBCE";
  const FRIEND_CALLS: ClimateGroup[] = ["Tropical", "Arid", "Arid", "Temperate", "Polar"];

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
    window.history.replaceState(null, "", `/which-climate?challenge=${value}&x=1`);
    return setup();
  }

  it("deals the friend's five, shows their call once yours is in, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 3 of 5 to beat.")).toBeVisible();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", IDS[n]));
      await waitFor(() => expect(button("Arid")).toBeEnabled());
      // Nothing of the friend's call shows before yours.
      expect(screen.queryByTestId("climate-friend")).toBeNull();
      const truth = GROUPS[IDS[n]];
      // Right on all but the last.
      fireEvent.click(button(n < 4 ? truth : wrongFor(truth)));
      const card = await screen.findByRole("region");
      const theirs = FRIEND_CALLS[n];
      expect(within(card).getByTestId("climate-friend")).toHaveTextContent(
        `Your friend called it ${theirs.toLowerCase()}${theirs === truth ? ", and got it." : ": wrong."}`,
      );
      expect(
        within(card).getByTestId("climate-band").querySelector(`[data-group='${theirs}']`),
      ).toHaveTextContent("Friend");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "4 of 5" })).toBeInTheDocument();
    expect(screen.getByTestId("climate-challenge-line")).toHaveTextContent(
      "You beat your friend's 3 of 5 by 1.",
    );
    expect(screen.getAllByTestId("climate-row")[1]).toHaveTextContent("Friend: Arid ✗");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() => expect(screen.getByText(/Challenge link copied/)).toBeInTheDocument());
    const mine = IDS.map((id, i) => {
      const g = i < 4 ? GROUPS[id] : wrongFor(GROUPS[id]);
      return "ABCDE"[["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(g)];
    }).join("");
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Which climate?: I named 4 of 5 climates right.",
      "That beats your 3. Your turn to read the weather.",
      `http://localhost:3000/which-climate?challenge=${IDS.join(".")}_${mine}`,
    ]);

    // The head to head is drawn photo by photo, with no photo in it.
    const drawn = stubCanvas();
    fireEvent.click(screen.getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-which-climate-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining(["You won", "4 of 5", "3 of 5", "Photo 1", "Right", "Wrong"]),
    );
    const all = drawn.words.join("\n");
    for (const id of IDS) expect(all).not.toContain(id);
    drawn.restore();

    // A fresh game leaves the link behind.
    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    await waitFor(() =>
      expect(screen.getByText("Which climate? Name the Köppen group.")).toBeVisible(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when a link is cut short or its photos have gone, and deals a fresh game", async () => {
    await linked("t1.m1.a1_ABB");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(screen.getByText("Which climate? Name the Köppen group.")).toBeVisible();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("t1.m1.a1.c1.gone_ABBCE");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a whole free game", async () => {
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n]));
      await waitFor(() => expect(button("Arid")).toBeEnabled());
      fireEvent.click(button(truthOf(n)));
      const card = await screen.findByRole("region");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    await screen.findByRole("heading", { level: 1, name: "5 of 5" });
    expect(screen.queryByRole("button", { name: "Share head to head" })).toBeNull();
    const box = clipboard();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    const letters = ORDER.map(
      (id) =>
        "ABCDE"[["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(GROUPS[id])],
    ).join("");
    expect(box.sent.split("\n")[2]).toBe(
      `http://localhost:3000/?challenge=${ORDER.join(".")}_${letters}`,
    );
  });
});

describe("WhichClimate, practising your mix-ups", () => {
  function play() {
    const game = gameFor(RECORDS);
    return render(
      <WhichClimate
        deck={game.deck}
        groups={GROUPS}
        loadRecords={game.loadRecords}
        random={() => 0}
        practice
      />,
    );
  }

  it("deals five photos of the climates misread and those they were taken for, with its own best", async () => {
    // Tropical taken for arid, temperate for continental: four climates, seven photos.
    localStorage.setItem(
      CLIMATE_CALLS_KEY,
      JSON.stringify([
        { truth: "Tropical", picked: "Arid" },
        { truth: "Temperate", picked: "Continental" },
        { truth: "Polar", picked: "Polar" },
      ]),
    );
    const order = dealClimate(
      practiceMap(GROUPS, ["Tropical", "Arid", "Temperate", "Continental"]),
      0,
    );
    expect(order).toHaveLength(5);
    expect(order.some((id) => GROUPS[id] === "Polar")).toBe(false);
    play();
    expect(
      await screen.findByText(
        "Which climate?, your mix-ups: tropical, arid, temperate and continental.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[n]));
      await waitFor(() => expect(button("Arid")).toBeEnabled());
      fireEvent.click(button(n < 4 ? GROUPS[order[n]] : wrongFor(GROUPS[order[n]])));
      const card = await screen.findByRole("region");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "4 of 5" })).toBeInTheDocument();
    expect(screen.getByText("That's your new best at your mix-ups!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLIMATE_MIX_UPS_KEY)).toBe("4");
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBeNull();
    // Its calls are kept like any other, so a climate still misread keeps coming back.
    expect(loadClimateCalls()).toHaveLength(8);
    // The photos were picked for this player, so there's no challenge to send.
    expect(screen.queryByRole("button", { name: "Challenge a friend" })).toBeNull();
    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
  });

  it("says there's nothing to practise before a climate has been called wrong", async () => {
    localStorage.setItem(CLIMATE_CALLS_KEY, JSON.stringify([{ truth: "Arid", picked: "Arid" }]));
    play();
    expect(await screen.findByText("No climate mix-ups to practise yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play Which climate?" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
  });

  it("says when the climates to practise have too few photos", async () => {
    // Polar taken for arid: one polar and two arid photos can't fill a game.
    localStorage.setItem(CLIMATE_CALLS_KEY, JSON.stringify([{ truth: "Polar", picked: "Arid" }]));
    play();
    expect(
      await screen.findByText("There aren't enough arid and polar photos to deal a game yet."),
    ).toBeInTheDocument();
  });
});
