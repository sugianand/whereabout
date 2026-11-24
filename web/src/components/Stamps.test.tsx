import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BEST_TIGHT_KEY, settleBet } from "@/lib/game/bullseye";
import { recordBullseyeRound } from "@/lib/game/bullseyeCalibration";
import { BEST_HOTTEST_KEY } from "@/lib/game/spotClue";
import { recordSpotRead } from "@/lib/game/spotRead";
import { rememberClimateDay } from "@/lib/game/climateDaily";
import { rememberGroundDay } from "@/lib/game/groundDaily";
import { BEST_LEFT_RIGHT_KEY } from "@/lib/game/leftRight";
import { rememberNameDay } from "@/lib/game/nameDaily";
import { QUICK_RECORD_KEY } from "@/lib/game/quickRecord";
import { rememberOddDay } from "@/lib/game/oddDaily";
import { PLAYED_KEY } from "@/lib/playedMap";
import { RECORD_KEY } from "@/lib/playerRecord";
import { STAMPS_KEY } from "@/lib/stamps";
import { TOUR_KEY } from "@/lib/tour";

import Stamps from "./Stamps";

const IDS = ["a", "b", "c", "d", "e"];
const COUNTRIES = { Oceania: ["AU", "NZ", "PF"], Europe: ["FR", "GB"] };
const now = () => new Date("2026-11-10T12:00:00Z");

const pin = (id: string, country: string, km: number) => ({
  id,
  lng: 0,
  lat: 0,
  place: "Somewhere",
  country,
  km,
  score: 3000,
  day: "2026-11-09",
});

beforeEach(() => localStorage.clear());

describe("Stamps", () => {
  it("shows every stamp uncollected on a first visit, with the next one up", async () => {
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(/^0 of 33 collected\.$/);
    expect(screen.getByRole("heading", { name: "Continents cleared" })).toBeInTheDocument();
    expect(screen.getByTestId("stamp-cleared-oceania")).toHaveAttribute("data-earned", "false");
    expect(screen.getByTestId("stamp-cleared-oceania-progress")).toHaveTextContent(
      "0 of 3 countries",
    );
    // Nothing started: the first stamp with progress is the one named next.
    expect(screen.getByTestId("stamps-next")).toHaveTextContent(
      "Next up: First win, 1 round won to go.",
    );
    expect(localStorage.getItem(STAMPS_KEY)).toBeNull();
  });

  it("collects what the browser's records show, marks it new once, and keeps it", async () => {
    localStorage.setItem(
      PLAYED_KEY,
      JSON.stringify([
        pin("p1", "AU", 40),
        pin("p2", "NZ", 900),
        pin("p3", "PF", 300),
        pin("p4", "FR", 61),
      ]),
    );
    localStorage.setItem(
      RECORD_KEY,
      JSON.stringify({
        games: 1,
        roundsVsAtlas: 4,
        roundsWon: 2,
        best: 9000,
        lastDaily: null,
        streak: 0,
        bestStreak: 0,
        continents: {},
        badges: [],
      }),
    );
    const { unmount } = render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    const standing = await screen.findByTestId("stamps-standing");
    expect(standing).toHaveTextContent("2 of 33 collected. 2 new stamps since you last looked.");
    const oceania = screen.getByTestId("stamp-cleared-oceania");
    expect(oceania).toHaveAttribute("data-earned", "true");
    expect(within(oceania).getByText("New")).toBeInTheDocument();
    expect(within(oceania).queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("stamp-first-win")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-bullseye")).toHaveTextContent("Closest pin so far: 40 km");
    expect(
      screen.getByRole("progressbar", { name: "Europe cleared: 1 of 2 countries" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("stamp-cleared-europe")).toHaveTextContent(
      "Still to play: United Kingdom",
    );
    expect(screen.getByTestId("stamps-next")).toHaveTextContent(
      "Next up: Europe cleared, 1 country to go.",
    );
    unmount();

    // The map forgotten, the stamp stays, no longer new.
    localStorage.removeItem(PLAYED_KEY);
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(/^2 of 33 collected\.$/);
    const kept = screen.getByTestId("stamp-cleared-oceania");
    expect(kept).toHaveAttribute("data-earned", "true");
    expect(within(kept).queryByText("New")).toBeNull();
  });

  it("earns a Beat Atlas stamp from a game each daily keeps, and says how close a loss came", async () => {
    // Yesterday's Name the country: 3 right to Atlas's 2 on the same four photos.
    rememberNameDay("2026-11-09", { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" });
    // Today's Odd one out: 1 right to Atlas's 2.
    rememberOddDay("2026-11-10", { streak: 1, atlasRight: 2, atlasPlayed: 2, ended: "miss" });
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(
      "1 of 33 collected. 1 new stamp since you last looked.",
    );
    expect(screen.getByRole("heading", { name: "Beat Atlas" })).toBeInTheDocument();
    const won = screen.getByTestId("stamp-beat-atlas-name-country");
    expect(won).toHaveAttribute("data-earned", "true");
    expect(within(won).getByText("New")).toBeInTheDocument();
    expect(screen.getByTestId("stamp-beat-atlas-odd-one-out")).toHaveTextContent(
      "Closest so far: 1 right to Atlas's 2",
    );
    expect(
      within(screen.getByTestId("stamps-atlas-intro")).getByRole("link", {
        name: "Atlas's day on Today",
      }),
    ).toHaveAttribute("href", "/today");
  });

  it("earns the clue stamps from what the clue games keep, and says where the rest stand", async () => {
    // A free Left or right? run of 10, and yesterday's Which climate? five of five.
    localStorage.setItem(BEST_LEFT_RIGHT_KEY, "10");
    rememberClimateDay(
      "2026-11-09",
      ["a", "b", "c", "d", "e"].map((id) => ({
        id,
        picked: "Arid" as const,
        truth: "Arid" as const,
        correct: true,
        atlas: "Temperate" as const,
      })),
    );
    // Today's What's on the ground?, five of five, Atlas reading only the one built-up photo.
    rememberGroundDay(
      "2026-11-10",
      (["Built-up", "Grassland", "Tree cover", "Grassland", "Tree cover"] as const).map(
        (cover, i) => ({
          id: `g${i}`,
          picked: cover,
          truth: cover,
          correct: true,
          atlas: cover === "Built-up" ? cover : null,
        }),
      ),
    );
    // 40 free road calls, 30 right, Atlas 33 of 40: behind past thirty photos.
    const free = { runs: 3, rounds: 40, right: 30, atlasPlayed: 40, atlasRight: 33 };
    // 34 free ground calls, 27 right; Atlas read 29 of them: one photo short.
    const ground = { runs: 7, rounds: 34, right: 27, atlasPlayed: 29, atlasRight: 12 };
    localStorage.setItem(
      QUICK_RECORD_KEY,
      JSON.stringify({ "left-right": free, "on-the-ground": ground }),
    );
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(
      "4 of 33 collected. 4 new stamps since you last looked.",
    );
    expect(screen.getByRole("heading", { name: "Reading the clues" })).toBeInTheDocument();
    expect(screen.getByTestId("stamp-road-reader")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-climate-reader")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-ground-reader")).toHaveAttribute("data-earned", "true");
    // Today's game makes it 30 photos read with Atlas: you 82% (32 of 39), Atlas 43% (13 of 30).
    expect(screen.getByTestId("stamp-ground-ahead")).toHaveAttribute("data-earned", "true");
    const road = screen.getByTestId("stamp-road-ahead");
    expect(road).toHaveAttribute("data-earned", "false");
    expect(within(road).queryByRole("progressbar")).toBeNull();
    expect(road).toHaveTextContent("Atlas is ahead of you by 8 points. Read on to pull ahead.");
    // The climate day is five photos read with Atlas, all of them right to its none.
    expect(screen.getByTestId("stamp-climate-ahead-progress")).toHaveTextContent(
      "5 of 30 photos read with Atlas",
    );
    expect(screen.getByTestId("stamp-climate-ahead")).toHaveTextContent(
      "So far: you 100%, Atlas 0%",
    );
    const intro = screen.getByTestId("stamps-clues-intro");
    expect(within(intro).getByRole("link", { name: "Left or right?" })).toHaveAttribute(
      "href",
      "/left-right",
    );
    expect(within(intro).getByRole("link", { name: "Which climate?" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    expect(within(intro).getByRole("link", { name: "What's on the ground?" })).toHaveAttribute(
      "href",
      "/on-the-ground",
    );
  });

  it("shows the album's stamps with how close you are, and collects a full page", async () => {
    const album = { p1: "Oceania", p2: "Oceania", p4: "Europe", e2: "Europe" } as const;
    localStorage.setItem(PLAYED_KEY, JSON.stringify([pin("p1", "AU", 40), pin("p2", "NZ", 900)]));
    render(<Stamps countries={COUNTRIES} deckIds={IDS} album={album} now={now} />);
    expect(await screen.findByRole("heading", { name: "Your album" })).toBeInTheDocument();
    const intro = screen.getByTestId("stamps-album-intro");
    expect(within(intro).getByRole("link", { name: "your album" })).toHaveAttribute(
      "href",
      "/album",
    );
    expect(within(intro).getByRole("link", { name: "Find the rest" })).toHaveAttribute(
      "href",
      "/?find",
    );
    // Two of four found: the quarter and half, and Oceania's page.
    expect(screen.getByTestId("stamp-album-quarter")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-album-half")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-album-oceania-page")).toHaveAttribute("data-earned", "true");
    expect(screen.getByTestId("stamp-album-whole-progress")).toHaveTextContent(
      "2 of 4 photos found",
    );
    expect(screen.getByTestId("stamp-album-europe-page-progress")).toHaveTextContent(
      "0 of 2 photos found",
    );
    expect(JSON.parse(localStorage.getItem(STAMPS_KEY)!)).toMatchObject({
      "album-quarter": "2026-11-10",
      "album-oceania-page": "2026-11-10",
    });
  });

  it("shows the World Tour's stamps from the tour's record, with the legs left", async () => {
    localStorage.setItem(
      TOUR_KEY,
      JSON.stringify({
        Europe: { tries: 2, best: { you: 14000, atlas: 12000 }, cleared: "2026-11-09" },
        Africa: { tries: 1, best: { you: 8000, atlas: 9500 }, cleared: null },
      }),
    );
    render(
      <Stamps
        countries={COUNTRIES}
        deckIds={IDS}
        tourRoute={["Europe", "Africa", "Asia"]}
        now={now}
      />,
    );
    expect(await screen.findByRole("heading", { name: "World Tour" })).toBeInTheDocument();
    const intro = screen.getByTestId("stamps-tour-intro");
    expect(within(intro).getByRole("link", { name: "World Tour" })).toHaveAttribute(
      "href",
      "/tour",
    );
    expect(screen.getByTestId("stamp-tour-europe")).toHaveAttribute("data-earned", "true");
    const africa = screen.getByTestId("stamp-tour-africa");
    expect(africa).toHaveAttribute("data-earned", "false");
    expect(africa).toHaveTextContent("Closest so far: 8,000 points to Atlas's 9,500");
    expect(screen.getByTestId("stamp-tour-complete-progress")).toHaveTextContent("1 of 3 legs");
    expect(JSON.parse(localStorage.getItem(STAMPS_KEY)!)).toEqual({ "tour-europe": "2026-11-10" });
  });

  it("shows Bullseye's stamps from the tight rings kept and every ring bet", async () => {
    localStorage.setItem(BEST_TIGHT_KEY, "5");
    const at = { lng: 0, lat: 0 };
    // Four photos bet beside Atlas: your 2,000 km ring held three, Atlas's 750 km ring one.
    for (let i = 0; i < 4; i++) {
      recordBullseyeRound({
        id: `p${i}`,
        you: settleBet(at, 2, i < 3 ? 100 : 9000),
        atlas: settleBet(at, 1, i < 1 ? 100 : 9000),
      });
    }
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByRole("heading", { name: "Bullseye" })).toBeInTheDocument();
    const intro = screen.getByTestId("stamps-bullseye-intro");
    expect(within(intro).getByRole("link", { name: "Bullseye" })).toHaveAttribute(
      "href",
      "/bullseye",
    );
    expect(within(intro).getByRole("link", { name: /your calibration/ })).toHaveAttribute(
      "href",
      "/map",
    );
    expect(screen.getByTestId("stamp-bullseye-five-tight")).toHaveAttribute("data-earned", "true");
    const calibrated = screen.getByTestId("stamp-bullseye-calibrated");
    expect(calibrated).toHaveAttribute("data-earned", "false");
    expect(screen.getByTestId("stamp-bullseye-calibrated-progress")).toHaveTextContent(
      "4 of 30 photos bet with Atlas",
    );
    expect(calibrated).toHaveTextContent("Rings held so far: yours 75%, Atlas's 25%");
    expect(JSON.parse(localStorage.getItem(STAMPS_KEY)!)).toEqual({
      "bullseye-five-tight": "2026-11-10",
    });
  });
  it("shows Spot the clue's stamps from the most hottest kept and every square found", async () => {
    localStorage.setItem(BEST_HOTTEST_KEY, "4");
    const cells = Array<number>(49).fill(0);
    cells[6] = 1;
    // Three squares picked, two of them Atlas's hottest.
    for (const cell of [6, 6, 30]) recordSpotRead({ grid: 7, crop: [0, 0, 1, 1], cells }, cell);
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByRole("heading", { name: "Spot the clue" })).toBeInTheDocument();
    const intro = screen.getByTestId("stamps-spot-intro");
    expect(within(intro).getByRole("link", { name: "Spot the clue" })).toHaveAttribute(
      "href",
      "/spot-the-clue",
    );
    expect(within(intro).getByRole("link", { name: "today's Spot the clue" })).toHaveAttribute(
      "href",
      "/spot-the-clue/daily",
    );
    expect(within(intro).getByRole("link", { name: /your read of Atlas/ })).toHaveAttribute(
      "href",
      "/map",
    );
    expect(screen.getByTestId("stamp-spot-mind-reader")).toHaveAttribute("data-earned", "false");
    expect(screen.getByTestId("stamp-spot-mind-reader-progress")).toHaveTextContent(
      "4 of 5 hottest squares in a game",
    );
    expect(screen.getByTestId("stamp-spot-found-progress")).toHaveTextContent(
      "2 of 25 squares found",
    );
  });

  it("collects Mind reader from a whole game of five", async () => {
    localStorage.setItem(BEST_HOTTEST_KEY, "5");
    render(<Stamps countries={COUNTRIES} deckIds={IDS} now={now} />);
    expect(await screen.findByTestId("stamp-spot-mind-reader")).toHaveAttribute(
      "data-earned",
      "true",
    );
    expect(JSON.parse(localStorage.getItem(STAMPS_KEY)!)).toEqual({
      "spot-mind-reader": "2026-11-10",
    });
  });
});
