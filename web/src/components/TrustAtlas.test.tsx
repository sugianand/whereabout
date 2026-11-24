import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_TRUST_KEY, TRUST_PHOTOS, dealTrust } from "@/lib/game/trustAtlas";
import { TRUST_DAILY_KEY, dailyTrustOrder, loadTrustDay } from "@/lib/game/trustDaily";
import { gameFor } from "@/test/deck";

import TrustAtlas from "./TrustAtlas";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Every photo is in France. Even ones: Atlas says France, 82% sure (right, and it trusts itself).
// Odd ones: Atlas says Belgium, 30% sure, with France its runner-up at 25% (wrong, and it doubts).
function record(id: string, i: number): GameRecord {
  const right = i % 2 === 0;
  const top = right
    ? [{ country: "FR", p: 0.82 }]
    : [
        { country: "BE", p: 0.3 },
        { country: "FR", p: 0.25 },
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
    atlas: { lng: 2, lat: 48, confidence: top[0]!.p, topCountries: top, clues: [] },
  };
}

const RECORDS = Array.from({ length: 12 }, (_, i) => record(`t${i}`, i));
const IDS = RECORDS.map((r) => r.photo.id);
// random() = 0 deals from seed 0.
const ORDER = dealTrust(IDS, 0);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));
const atlasRight = (id: string) => byId.get(id)!.atlas!.topCountries[0]!.country === "FR";

async function setup() {
  const game = gameFor(RECORDS);
  render(<TrustAtlas deck={game.deck} ids={IDS} loadRecords={game.loadRecords} random={() => 0} />);
  await screen.findByRole("button", { name: "Trust it: Atlas is right" });
  await waitEnabled();
}

async function waitEnabled() {
  const trust = screen.getByRole("button", { name: "Trust it: Atlas is right" });
  await expect.poll(() => (trust as HTMLButtonElement).disabled).toBe(false);
}

const photoOn = () => document.querySelector("main")?.getAttribute("data-photo");

describe("TrustAtlas", () => {
  it("shows Atlas's answer and how sure it is, as words and a meter", async () => {
    await setup();
    const id = ORDER[0]!;
    expect(photoOn()).toBe(id);
    const sure = atlasRight(id) ? "France, 82% sure" : "Belgium, 30% sure";
    expect(screen.getByTestId("trust-question")).toHaveTextContent(
      `Atlas says ${sure}. Is it right?`,
    );
    expect(screen.getByRole("meter", { name: "How sure Atlas is" })).toHaveAttribute(
      "aria-valuenow",
      atlasRight(id) ? "82" : "30",
    );
    // The place isn't given away before the call.
    expect(screen.queryByText(`Place ${id}`)).toBeNull();
  });

  it("judges a tapped call on the photo's real country, with Atlas's own call beside it", async () => {
    await setup();
    const id = ORDER[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Trust it: Atlas is right" }));
    const card = screen.getByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent(
      atlasRight(id) ? "Called it" : "Missed it",
    );
    expect(within(card).getByTestId("trust-truth")).toHaveTextContent(
      atlasRight(id)
        ? "Atlas was right: it is France."
        : "Atlas was wrong: it is France. France was Atlas's 2nd pick, at 25%.",
    );
    expect(within(card).getByText(`Place ${id}`)).toBeInTheDocument();
    // Atlas's own call is right on every photo here: sure when right, unsure when wrong.
    expect(within(card).getByTestId("trust-atlas")).toHaveTextContent(
      `${atlasRight(id) ? "At 82% sure, Atlas trusted its answer" : "At only 30% sure, Atlas doubted its answer"}, and that call was right. So far: you ${atlasRight(id) ? 1 : 0} of 1, Atlas's own calls 1 of 1.`,
    );
    expect(screen.getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("plays ten photos by key, Y and N, into the results, and keeps the best", async () => {
    await setup();
    for (let n = 0; n < TRUST_PHOTOS; n++) {
      await waitEnabled();
      expect(photoOn()).toBe(ORDER[n]);
      // Always the right call, by key.
      fireEvent.keyDown(window, { key: atlasRight(ORDER[n]!) ? "y" : "N" });
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Called it");
      // A second key on the answer does nothing.
      fireEvent.keyDown(window, { key: "y" });
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Called it");
      fireEvent.click(
        screen.getByRole("button", {
          name: n === TRUST_PHOTOS - 1 ? "See the results" : "Next photo",
        }),
      );
    }
    expect(
      await screen.findByRole("heading", { level: 1, name: "10 of 10 called right" }),
    ).toBeInTheDocument();
    const right = ORDER.filter(atlasRight).length;
    expect(screen.getByTestId("trust-end")).toHaveTextContent(
      `Atlas was right on ${right} of 10. You and Atlas's own sureness called it level.`,
    );
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(screen.getAllByTestId("trust-row")).toHaveLength(10);
    expect(localStorage.getItem(BEST_TRUST_KEY)).toBe("10");
    expect(screen.getByRole("button", { name: "Play again" })).toHaveFocus();
  });

  it("keeps an earlier, better best and doesn't count an unfinished game", async () => {
    localStorage.setItem(BEST_TRUST_KEY, "7");
    await setup();
    // A miss on the first photo.
    fireEvent.keyDown(window, { key: atlasRight(ORDER[0]!) ? "n" : "y" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Missed it");
    expect(localStorage.getItem(BEST_TRUST_KEY)).toBe("7");
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("says so when there is nothing to deal", async () => {
    const game = gameFor([]);
    render(
      <TrustAtlas deck={game.deck} ids={[]} loadRecords={game.loadRecords} random={() => 0} />,
    );
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});

describe("today's Trust Atlas?", () => {
  const DAY = "2026-11-25";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const TODAY = dailyTrustOrder(IDS, DAY);

  function renderDaily() {
    const game = gameFor(RECORDS);
    return render(
      <TrustAtlas deck={game.deck} ids={IDS} loadRecords={game.loadRecords} daily now={now} />,
    );
  }

  /** Call photo `n` of today's game: rightly when `right`, else the wrong way. */
  async function call(n: number, right: boolean) {
    await waitFor(() => expect(photoOn()).toBe(TODAY[n]));
    await waitEnabled();
    const trust = atlasRight(TODAY[n]!) === right;
    fireEvent.click(
      screen.getByRole("button", {
        name: trust ? "Trust it: Atlas is right" : "Doubt it: Atlas is wrong",
      }),
    );
    const card = await screen.findByRole("region");
    fireEvent.click(
      within(card).getByRole("button", {
        name: n === TRUST_PHOTOS - 1 ? "See the results" : "Next photo",
      }),
    );
  }

  it("deals the day's ten, keeps each call, and picks up after a reload at the next photo", async () => {
    localStorage.setItem(BEST_TRUST_KEY, "4");
    const { unmount } = renderDaily();
    expect(await screen.findByText("Trust Atlas? Today: Is its answer right?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/trust-atlas",
    );
    // Today's game has no best of its own.
    expect(screen.queryByText("Best")).toBeNull();
    await call(0, true);
    await call(1, false);
    expect(loadTrustDay(DAY)?.results.map((r) => [r.id, r.correct])).toEqual([
      [TODAY[0], true],
      [TODAY[1], false],
    ]);

    unmount();
    renderDaily();
    await waitFor(() => expect(photoOn()).toBe(TODAY[2]));
    expect(screen.getByText("Photo 3 of 10")).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "dd" })).toBeInTheDocument();
    for (let n = 2; n < TRUST_PHOTOS; n++) await call(n, n !== 5);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "8 of 10 called right",
    );
    expect(screen.getByText(`Trust Atlas? · today's game · ${DAY}`)).toBeInTheDocument();
    // Every photo here is in France, and Atlas's own sureness calls every one of them right.
    const right = TODAY.filter(atlasRight).length;
    expect(
      screen.getByText(
        new RegExp(`^Atlas was right on ${right} of 10\\. Atlas.s own sureness called it better`),
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("trust-row")).toHaveLength(TRUST_PHOTOS);
    expect(screen.getByRole("button", { name: "Share today's game" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/trust-atlas",
    );
    // The free game's best is untouched.
    expect(localStorage.getItem(BEST_TRUST_KEY)).toBe("4");
  });

  it("shows a finished day's result instead of dealing it again, judged on the photos", async () => {
    // A forged day: each call claims Atlas was wrong and was rightly doubted, whatever the photo.
    const forged = TODAY.map((id) => ({
      id,
      call: "doubt",
      atlasRight: false,
      correct: true,
      atlasCall: "doubt",
      atlasCorrect: true,
    }));
    localStorage.setItem(TRUST_DAILY_KEY, JSON.stringify({ [DAY]: { results: forged } }));
    renderDaily();
    const wrong = TODAY.filter((id) => !atlasRight(id)).length;
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        `${wrong} of 10 called right`,
      ),
    );
    expect(screen.queryByRole("button", { name: "Trust it: Atlas is right" })).toBeNull();
  });

  it("links to today's game from a free one", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/trust-atlas/daily",
    );
  });
});
