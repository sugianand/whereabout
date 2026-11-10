import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { rememberNameDay } from "@/lib/game/nameDaily";
import { rememberOddDay } from "@/lib/game/oddDaily";
import { PLAYED_KEY } from "@/lib/playedMap";
import { RECORD_KEY } from "@/lib/playerRecord";
import { STAMPS_KEY } from "@/lib/stamps";

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
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(/^0 of 17 collected\.$/);
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
    expect(standing).toHaveTextContent("2 of 17 collected. 2 new stamps since you last looked.");
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
    expect(await screen.findByTestId("stamps-standing")).toHaveTextContent(/^2 of 17 collected\.$/);
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
      "1 of 17 collected. 1 new stamp since you last looked.",
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
});
