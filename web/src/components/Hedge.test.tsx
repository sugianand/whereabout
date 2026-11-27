import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import {
  BEST_HEDGE_KEY,
  HEDGE_PHOTOS,
  atlasChips,
  dealHedge,
  hedgeOptions,
  hedgeScore,
} from "@/lib/game/hedge";
import {
  HEDGE_DAILY_KEY,
  dailyHedgeOrder,
  dailyHedgeSeed,
  loadHedgeDay,
} from "@/lib/game/hedgeDaily";
import { countryName } from "@/lib/countries";
import { gameFor } from "@/test/deck";

import Hedge from "./Hedge";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Every photo is in France. Atlas weighs France at 60%, Belgium 20%, Switzerland 10% and
// Luxembourg 5%, so it bets 6/2/1/1 chips (renormalised over the four).
function record(id: string): GameRecord {
  const top = [
    { country: "FR", p: 0.6 },
    { country: "BE", p: 0.2 },
    { country: "CH", p: 0.1 },
    { country: "LU", p: 0.05 },
    { country: "DE", p: 0.05 },
  ];
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
      lng: 2,
      lat: 48,
      place: `Place ${id}`,
      country: "FR",
      credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
    },
    atlas: { lng: 2, lat: 48, confidence: 0.6, topCountries: top, clues: [] },
  };
}

const RECORDS = Array.from({ length: 8 }, (_, i) => record(`h${i}`));
const IDS = RECORDS.map((r) => r.photo.id);
// random() = 0 deals from seed 0.
const ORDER = dealHedge(IDS, 0);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));
const optionsOf = (n: number) => hedgeOptions(byId.get(ORDER[n]!)!, 0);

async function setup() {
  const game = gameFor(RECORDS);
  render(<Hedge deck={game.deck} ids={IDS} loadRecords={game.loadRecords} random={() => 0} />);
  await waitFor(() => expect(screen.getAllByTestId("hedge-option")).toHaveLength(4));
}

const plus = (country: string) =>
  screen.getByRole("button", { name: `Put a chip on ${countryName(country)}` });
const minus = (country: string) =>
  screen.getByRole("button", { name: `Take a chip off ${countryName(country)}` });
const betButton = () => screen.getByRole("button", { name: "Bet" });

function key(k: string) {
  fireEvent.keyDown(window, { key: k });
}

describe("Hedge", () => {
  it("offers the photo's country among Atlas's picks, with ten chips to place and no answer yet", async () => {
    await setup();
    const rows = screen.getAllByTestId("hedge-option");
    expect(rows.map((r) => r.getAttribute("data-country"))).toEqual(optionsOf(0));
    rows.forEach((row, i) => expect(row).toHaveTextContent(countryName(optionsOf(0)[i]!)));
    expect(screen.getByTestId("hedge-left")).toHaveTextContent("10 chips to place");
    expect(betButton()).toBeDisabled();
    expect(screen.queryByText(`Place ${ORDER[0]}`)).toBeNull();
  });

  it("places and takes back chips by tap, and bets only with all ten on", async () => {
    await setup();
    for (let i = 0; i < 7; i++) fireEvent.click(plus("FR"));
    fireEvent.click(plus("BE"));
    fireEvent.click(plus("BE"));
    fireEvent.click(minus("BE"));
    expect(screen.getByTestId("hedge-left")).toHaveTextContent("2 chips to place");
    expect(betButton()).toBeDisabled();
    fireEvent.click(plus("CH"));
    fireEvent.click(plus("CH"));
    expect(screen.getByTestId("hedge-left")).toHaveTextContent("All ten on");
    // No more chips: every + is off.
    expect(plus("LU")).toBeDisabled();
    fireEvent.click(betButton());

    const options = optionsOf(0);
    const mine = options.map((c) => ({ FR: 7, BE: 1, CH: 2 })[c] ?? 0);
    const theirs = atlasChips(byId.get(ORDER[0]!)!.atlas, options);
    const right = options.indexOf("FR");
    const card = await screen.findByRole("region", { name: /read it better|Level/ });
    expect(within(card).getByTestId("hedge-points")).toHaveTextContent(
      `You scored ${hedgeScore(mine, right)} of 1,000, Atlas ${hedgeScore(theirs, right)}.`,
    );
    expect(within(card).getByTestId("hedge-line")).toHaveTextContent(
      "It is France: Place " + ORDER[0] + ". You had 7 chips on France, Atlas 6 chips.",
    );
    // Both bets on every country, the right one marked.
    const both = within(card).getAllByTestId("hedge-both");
    expect(both).toHaveLength(4);
    expect(both[right]).toHaveTextContent("France, the right country");
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("bets by key: 1 to 4 put chips on, Backspace takes the last back, G bets", async () => {
    await setup();
    const options = optionsOf(0);
    const fr = String(options.indexOf("FR") + 1);
    const other = String(((options.indexOf("FR") + 1) % 4) + 1);
    key("g"); // Nothing placed: no bet.
    expect(screen.queryByRole("region")).toBeNull();
    for (let i = 0; i < 9; i++) key(fr);
    key(other);
    key("Backspace");
    expect(screen.getByTestId("hedge-left")).toHaveTextContent("1 chip to place");
    key(fr);
    key(fr); // Over ten: ignored.
    key("g");
    const card = await screen.findByRole("region", { name: /read it better|Level/ });
    expect(within(card).getByTestId("hedge-points")).toHaveTextContent(
      /^You scored 1,000 of 1,000/,
    );
  });

  it("plays five photos, totals both sides, and keeps the best", async () => {
    await setup();
    for (let n = 0; n < HEDGE_PHOTOS; n++) {
      await waitFor(() =>
        expect(document.querySelector("main")).toHaveAttribute("data-photo", ORDER[n]),
      );
      await waitFor(() => expect(plus("FR")).toBeEnabled());
      const fr = String(optionsOf(n).indexOf("FR") + 1);
      for (let i = 0; i < 10; i++) key(fr);
      key("g");
      const label = n === HEDGE_PHOTOS - 1 ? "See the results" : "Next photo";
      fireEvent.click(await screen.findByRole("button", { name: label }));
    }
    expect(
      await screen.findByRole("heading", { level: 1, name: "5,000 points" }),
    ).toBeInTheDocument();
    const theirs = hedgeScore(atlasChips(record("x").atlas, ["FR", "BE", "CH", "LU"]), 0)!;
    expect(screen.getByTestId("hedge-end")).toHaveTextContent(
      `Atlas scored ${(theirs * 5).toLocaleString("en-US")}. You read the odds better than Atlas's own probabilities.`,
    );
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(screen.getAllByTestId("hedge-row")).toHaveLength(HEDGE_PHOTOS);
    expect(localStorage.getItem(BEST_HEDGE_KEY)).toBe("5000");
    expect(screen.getByRole("button", { name: "Play again" })).toHaveFocus();
  }, 20_000);
});

describe("today's Hedge your bets", () => {
  const DAY = "2026-11-28";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const TODAY = dailyHedgeOrder(IDS, DAY);
  const todaysOptions = (n: number) => hedgeOptions(byId.get(TODAY[n]!)!, dailyHedgeSeed(DAY));

  function renderDaily() {
    const game = gameFor(RECORDS);
    return render(
      <Hedge deck={game.deck} ids={IDS} loadRecords={game.loadRecords} daily now={now} />,
    );
  }

  /** Bet photo `n` of today's game all in on France, or all in on another country. */
  async function allIn(n: number, right: boolean) {
    await waitFor(() =>
      expect(document.querySelector("main")).toHaveAttribute("data-photo", TODAY[n]),
    );
    await waitFor(() => expect(plus("FR")).toBeEnabled());
    const options = todaysOptions(n);
    // The countries are offered in the day's order, the same for everyone.
    expect(screen.getAllByTestId("hedge-option").map((r) => r.dataset.country)).toEqual(options);
    const fr = options.indexOf("FR");
    const at = String((right ? fr : (fr + 1) % 4) + 1);
    for (let i = 0; i < 10; i++) key(at);
    key("g");
    const label = n === HEDGE_PHOTOS - 1 ? "See the results" : "Next photo";
    fireEvent.click(await screen.findByRole("button", { name: label }));
  }

  it("deals the day's five, keeps each bet, and picks up after a reload at the next photo", async () => {
    localStorage.setItem(BEST_HEDGE_KEY, "1200");
    const { unmount } = renderDaily();
    expect(await screen.findByText("Hedge your bets today: spread ten chips")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/hedge");
    // Today's game has no best of its own.
    expect(screen.queryByText("Best")).toBeNull();
    await allIn(0, true);
    await allIn(1, false);
    expect(loadHedgeDay(DAY)?.results.map((r) => [r.id, r.score])).toEqual([
      [TODAY[0], 1000],
      [TODAY[1], 0],
    ]);

    unmount();
    renderDaily();
    await waitFor(() =>
      expect(document.querySelector("main")).toHaveAttribute("data-photo", TODAY[2]),
    );
    expect(screen.getByText("Photo 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("1,000", { selector: "dd" })).toBeInTheDocument();
    for (let n = 2; n < HEDGE_PHOTOS; n++) await allIn(n, true);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("4,000 points");
    expect(screen.getByText(`Hedge your bets · today's game · ${DAY}`)).toBeInTheDocument();
    // Atlas bets 6/2/1/1 on every photo here, France its six: 890 a photo.
    expect(
      screen.getByText(
        /^Atlas's probabilities scored 4,450\. Atlas's probabilities read the odds better/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("hedge-row")).toHaveLength(HEDGE_PHOTOS);
    expect(screen.getByRole("button", { name: "Share today's game" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/hedge",
    );
    // The free game's best is untouched.
    expect(localStorage.getItem(BEST_HEDGE_KEY)).toBe("1200");
  }, 30_000);

  it("shows a finished day's result instead of dealing it again, scored on the photos", async () => {
    // A forged day: every bet claims all ten on France was all in on a wrong country, Atlas's
    // chips made up to match.
    const forged = TODAY.map((id, n) => {
      const options = todaysOptions(n);
      const fr = options.indexOf("FR");
      const wrong = (fr + 1) % 4;
      const chips = options.map((_, i) => (i === fr ? 10 : 0));
      const atlas = options.map((_, i) => (i === wrong ? 10 : 0));
      return { id, options, chips, atlasChips: atlas, right: wrong, score: 0, atlasScore: 1000 };
    });
    localStorage.setItem(HEDGE_DAILY_KEY, JSON.stringify({ [DAY]: { results: forged } }));
    renderDaily();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5,000 points"),
    );
    expect(
      screen.getByText(/^Atlas's probabilities scored 4,450\. You read the odds better/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bet" })).toBeNull();
  });

  it("links to today's game from a free one", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/hedge/daily",
    );
  });
});
