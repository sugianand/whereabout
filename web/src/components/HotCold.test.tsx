import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { BEST_HOT_KEY, PIN_BONUS } from "@/lib/game/hotCold";
import { HOT_DAILY_KEY, dailyHotOrder, loadHotDay } from "@/lib/game/hotDaily";
import type { CatalogPhoto } from "@/lib/game/types";
import { formatPoints, scoreDistance } from "@/lib/geo";
import { gameFor } from "@/test/deck";
import { FakeMap, FakeMarker, resetFakes } from "@/test/maplibre-mock";

import HotCold from "./HotCold";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const PLACES: [string, string, number, number][] = [
  ["p1", "FR", 2.35, 48.86],
  ["p2", "JP", 139.69, 35.69],
  ["p3", "BR", -47.88, -15.79],
  ["p4", "AU", 151.21, -33.87],
  ["p5", "EG", 31.24, 30.04],
  ["p6", "CA", -75.7, 45.42],
];

function record([id, country, lng, lat]: (typeof PLACES)[number], atlas = true): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    lng,
    lat,
    place: `Somewhere ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  // Atlas always pins exactly the place, so its score is the most a pin can get.
  return {
    photo,
    atlas: atlas ? { lng, lat, confidence: 0.6, topCountries: [], clues: [] } : null,
  };
}

const RECORDS = PLACES.map((p) => record(p));
const byId = new Map(RECORDS.map((r) => [r.photo.id, r.photo]));
// random() = 0 shuffles with seed 0.
const ORDER = seededShuffle(
  RECORDS.map((r) => r.photo.id),
  0,
)
  .slice(0, 5)
  .map((id) => byId.get(id)!);

/** Mid-ocean, in no country, a long way from everything dealt here. */
const SEA = { lng: -150, lat: -5 };
const SEA2 = { lng: -160, lat: 5 };

beforeEach(() => {
  window.history.replaceState(null, "", "/hot-cold");
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup(records = RECORDS) {
  const game = gameFor(records);
  render(<HotCold deck={game.deck} loadRecords={game.loadRecords} random={() => 0} />);
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  await screen.findByRole("button", { name: "Zoom in on the photo" });
  return map;
}

function pin(map: FakeMap, at: { lng: number; lat: number }, n = 1) {
  act(() => map.click(at.lng, at.lat));
  fireEvent.click(screen.getByRole("button", { name: `Drop pin ${n} of 3` }));
}

describe("HotCold", () => {
  it("needs a pin before one can drop, and deals five photos", async () => {
    await setup();
    expect(screen.getByRole("button", { name: "Tap the globe: pin 1 of 3" })).toBeDisabled();
    expect(screen.getByText("Hot and cold: photo 1 of 5")).toBeInTheDocument();
  });

  it("answers a miss with how far and which way, naming no place, and keeps the pin", async () => {
    const map = await setup();
    pin(map, SEA);
    expect(screen.queryByRole("region")).toBeNull();
    const clue = screen.getByTestId("hot-cold-clue");
    expect(clue).toHaveTextContent(/^[\d,]+ km off\. Head [a-z-]+\.$/);
    expect(clue.textContent).not.toContain(ORDER[0]!.place);
    expect(screen.getByTestId("hot-cold-arrow")).toHaveAttribute("data-bearing");
    expect(screen.getByRole("button", { name: "Tap the globe: pin 2 of 3" })).toBeDisabled();
    // The miss stays on the globe, numbered, so the arrow can be read from it.
    const trail = FakeMarker.instances.filter((m) =>
      m.element.classList.contains("globe-pin--trail"),
    );
    expect(trail.map((m) => [m.element.textContent, m.lngLat])).toEqual([
      ["1", [SEA.lng, SEA.lat]],
    ]);
    expect(screen.getByRole("application", { name: /Globe/ })).toHaveFocus();

    pin(map, SEA2, 2);
    expect(screen.getByTestId("hot-cold-clue")).toHaveTextContent(/^(Warmer|Colder)\. /);
  });

  it("ends the photo on the third pin, without a bonus, and says what it was", async () => {
    const map = await setup();
    pin(map, SEA);
    pin(map, SEA2, 2);
    pin(map, SEA, 3);
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent(/^.*Three pins, and it was /);
    expect(card).toHaveTextContent(`Somewhere ${ORDER[0]!.id}`);
    expect(within(card).queryByText(/ for \d pin/)).toBeNull();
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("ends the photo on the pin that finds the country, and plays five to the end", async () => {
    const map = await setup();
    let expected = 0;
    for (const [i, photo] of ORDER.entries()) {
      // The first photo takes a miss first, so it earns the second pin's bonus.
      if (i === 0) pin(map, SEA);
      pin(map, photo, i === 0 ? 2 : 1);
      const bonus = i === 0 ? PIN_BONUS[1] : PIN_BONUS[0];
      expected += scoreDistance(0) + bonus;
      const card = await screen.findByRole("region");
      expect(card).toHaveTextContent(`on pin ${i === 0 ? 2 : 1}`);
      expect(screen.getByTestId("hot-cold-score")).toHaveTextContent(formatPoints(expected));
      expect(card).toHaveTextContent(/Atlas's one pin was .+, in the country: 6,000 points\./);
      fireEvent.click(
        within(card).getByRole("button", { name: i === 4 ? "See your score" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      `${formatPoints(expected)} points`,
    );
    expect(screen.getByText(/That's your new best!/)).toBeInTheDocument();
    expect(screen.getByTestId("hot-cold-atlas-total")).toHaveTextContent(
      "Atlas scored 30,000 with one pin a photo, 500 ahead of you.",
    );
    expect(
      within(screen.getByRole("list", { name: "Your photos" })).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(localStorage.getItem(BEST_HOT_KEY)).toBe(String(expected));
  });

  it("leaves out Atlas where it never guessed", async () => {
    const map = await setup(PLACES.map((p) => record(p, false)));
    pin(map, ORDER[0]!);
    const card = await screen.findByRole("region");
    expect(card).not.toHaveTextContent("Atlas");
  });

  it("says when there is nothing to deal", async () => {
    const game = gameFor([]);
    render(<HotCold deck={game.deck} loadRecords={game.loadRecords} random={() => 0} />);
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});

describe("today's HotCold", () => {
  const DAY = "2026-11-05";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const today = dailyHotOrder(
    RECORDS.map((r) => r.photo.id),
    DAY,
  ).map((id) => byId.get(id)!);

  async function setupDay(remount = false) {
    const game = gameFor(RECORDS);
    const seen = FakeMap.instances.length;
    render(<HotCold deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
    if (remount) await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(seen));
    else await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    const map = FakeMap.instances.at(-1)!;
    act(() => map.emit("load"));
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    return map;
  }

  const shownId = () => document.querySelector("main")!.getAttribute("data-photo");

  it("deals the day's photos and keeps a miss through a reload, clue and all", async () => {
    window.history.replaceState(null, "", "/hot-cold/daily");
    const map = await setupDay();
    expect(shownId()).toBe(today[0]!.id);
    expect(screen.getByText("Hot and cold, today: photo 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/hot-cold");
    pin(map, SEA);
    const clue = screen.getByTestId("hot-cold-clue").textContent;
    expect(loadHotDay(DAY)).toMatchObject({ results: [], pins: [{ found: false }] });

    cleanup();
    await setupDay(true);
    expect(shownId()).toBe(today[0]!.id);
    expect(screen.getByTestId("hot-cold-clue")).toHaveTextContent(clue!);
    expect(screen.getByRole("button", { name: "Tap the globe: pin 2 of 3" })).toBeDisabled();
  });

  it("picks up at the next photo with the score so far", async () => {
    const map = await setupDay();
    pin(map, today[0]!);
    const kept = screen.getByTestId("hot-cold-score").textContent;
    cleanup();
    await setupDay(true);
    expect(shownId()).toBe(today[1]!.id);
    expect(screen.getByText("Hot and cold, today: photo 2 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("hot-cold-score")).toHaveTextContent(kept!);
  });

  it("ends in the day's result and never deals it again, leaving the free best alone", async () => {
    const map = await setupDay();
    for (const [i, photo] of today.slice(0, 5).entries()) {
      pin(map, photo);
      const card = await screen.findByRole("region");
      fireEvent.click(
        within(card).getByRole("button", { name: i === 4 ? "See your score" : "Next photo" }),
      );
    }
    const result = await screen.findByRole("heading", { level: 1, name: "30,000 points" });
    expect(result).toBeInTheDocument();
    expect(
      screen.getByText(/^Out of 30,000\. Atlas scored 30,000 .*next run is dealt/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.getByRole("list", { name: "Your photos" }).children).toHaveLength(5);
    expect(localStorage.getItem(BEST_HOT_KEY)).toBeNull();

    cleanup();
    const game = gameFor(RECORDS);
    render(<HotCold deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
    expect(await screen.findByRole("heading", { name: "30,000 points" })).toBeInTheDocument();
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("treats a day it can't read as not started", async () => {
    localStorage.setItem(HOT_DAILY_KEY, JSON.stringify({ [DAY]: { results: "no", pins: [] } }));
    await setupDay();
    expect(shownId()).toBe(today[0]!.id);
    expect(screen.getByText("Hot and cold, today: photo 1 of 5")).toBeInTheDocument();
  });

  it("links the free game to today's", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/hot-cold/daily",
    );
  });
});
