import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberNorthDay } from "@/lib/game/northDaily";
import { rememberOddDay } from "@/lib/game/oddDaily";

import Today from "./Today";

const IDS = ["a", "b", "c", "d", "e"];
const at = (iso: string) => () => new Date(iso);

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("Today", () => {
  it("links every daily game, and offers no share before a game is finished", async () => {
    render(<Today deckIds={IDS} now={at("2026-11-03T21:48:00Z")} />);
    const list = await screen.findByRole("list", { name: "Today's games" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual([
      "/?daily",
      "/further-north/daily",
      "/odd-one-out/daily",
      "/which-way/daily",
      "/how-far/daily",
      "/name-country/daily",
      "/hot-cold/daily",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "0 of 7 played. The next deal is in 2h 12m.",
    );
    expect(screen.queryByRole("button", { name: "Share your day" })).toBeNull();
  });

  it("lists a game that has joined the day, and counts it", async () => {
    render(<Today deckIds={IDS} now={at("2026-11-06T21:48:00Z")} />);
    expect(await screen.findByTestId("today-line-up")).toHaveAttribute("href", "/line-up/daily");
    expect(screen.getByRole("status")).toHaveTextContent(/^0 of 8 played/);
    expect(screen.getByLabelText("Today: 0 of 8 finished")).toBeInTheDocument();
    expect(screen.getByLabelText("November 5: 0 of 7 finished")).toBeInTheDocument();
  });

  it("lists Close-up from its first day, after Line them up", async () => {
    render(<Today deckIds={IDS} now={at("2026-11-07T09:00:00Z")} />);
    expect(await screen.findByTestId("today-close-up")).toHaveAttribute("href", "/close-up/daily");
    expect(screen.getByRole("status")).toHaveTextContent(/^0 of 9 played/);
    expect(screen.getByLabelText("Today: 0 of 9 finished")).toBeInTheDocument();
    expect(screen.getByLabelText("November 6: 0 of 8 finished")).toBeInTheDocument();
  });

  it("shows a finished run's result and shares the day", async () => {
    rememberNorthDay("2026-11-03", { streak: 4, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Today deckIds={IDS} now={at("2026-11-03T12:00:00Z")} />);

    const card = await screen.findByTestId("today-further-north");
    expect(card).toHaveAttribute("data-status", "done");
    expect(card).toHaveTextContent("4 pairs in a row");
    expect(card).toHaveTextContent("Atlas: 2 of 3");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share your day" }));
    });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]).toEqual([
      expect.stringContaining("1 of 7 daily games\n⬆️ Further North: 4 pairs in a row\n"),
    ]);
  });

  it("starts with an empty calendar and how to fill it", async () => {
    render(<Today deckIds={IDS} now={at("2026-11-03T12:00:00Z")} />);
    expect(await screen.findByTestId("full-day-streak")).toHaveTextContent(
      "Finish all 7 in one day to start a run of full days.",
    );
    const calendar = screen.getByRole("list", { name: "The last 4 weeks" });
    expect(within(calendar).getAllByRole("listitem")).toHaveLength(23);
    const today = screen.getByLabelText("Today: 0 of 7 finished");
    expect(today).toHaveAttribute("aria-current", "date");
  });

  it("marks how much of each past day was finished, and what a run needs today", async () => {
    const run = { streak: 2, atlasRight: 0, atlasPlayed: 0, ended: "miss" as const };
    rememberNorthDay("2026-11-02", run);
    rememberOddDay("2026-11-02", run);
    render(<Today deckIds={IDS} now={at("2026-11-03T12:00:00Z")} />);
    const cell = await screen.findByLabelText("November 2: 2 of 7 finished");
    expect(cell).toHaveTextContent("2");
    expect(screen.getByTestId("full-day-streak")).toHaveTextContent(/^Finish all 7/);
  });

  it("moves on to the new day's deal when the clock passes midnight UTC", async () => {
    vi.useFakeTimers();
    rememberNorthDay("2026-11-03", { streak: 4, atlasRight: 0, atlasPlayed: 0, ended: "miss" });
    let time = "2026-11-03T23:59:50Z";
    render(<Today deckIds={IDS} now={() => new Date(time)} />);
    await act(async () => {});
    expect(screen.getByTestId("today-further-north")).toHaveAttribute("data-status", "done");

    time = "2026-11-04T00:00:20Z";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("today-further-north")).toHaveAttribute("data-status", "new");
    expect(screen.getByText("2026-11-04")).toBeVisible();
  });

  it("reads the day again when the page comes back into view", async () => {
    render(<Today deckIds={IDS} now={at("2026-11-03T12:00:00Z")} />);
    const card = await screen.findByTestId("today-further-north");
    expect(card).toHaveAttribute("data-status", "new");

    rememberNorthDay("2026-11-03", { streak: 2, atlasRight: 0, atlasPlayed: 0, ended: null });
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(screen.getByTestId("today-further-north")).toHaveAttribute("data-status", "going");
    expect(screen.getByTestId("today-further-north")).toHaveTextContent("2 pairs in a row so far");
  });
});
