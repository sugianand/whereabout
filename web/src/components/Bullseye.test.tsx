import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEST_BULLSEYE_KEY, RINGS } from "@/lib/game/bullseye";
import { loadCalibration, loadFreeCalibration, totals } from "@/lib/game/bullseyeCalibration";
import { BULLSEYE_DAILY_KEY, dailyBullseyeOrder, loadBullseyeDay } from "@/lib/game/bullseyeDaily";
import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { haversineKm } from "@/lib/geo";
import { gameFor } from "@/test/deck";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Bullseye from "./Bullseye";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const PLACES: [string, string, number, number][] = [
  ["p1", "FR", 2.35, 48.86],
  ["p2", "JP", 139.69, 35.69],
  ["p3", "BR", -47.88, -15.79],
  ["p4", "AU", 151.21, -33.87],
  ["p5", "EG", 31.24, 30.04],
  ["p6", "CA", -75.7, 45.42],
];

function record([id, country, lng, lat]: (typeof PLACES)[number]): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    lng,
    lat,
    place: `Somewhere ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  // Atlas pins exactly the place at 90% sure, so it bets the tightest ring and holds it.
  return { photo, atlas: { lng, lat, confidence: 0.9, topCountries: [], clues: [] } };
}

const RECORDS = PLACES.map(record);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r.photo]));
// random() = 0 shuffles with seed 0.
const ORDER = seededShuffle(
  RECORDS.map((r) => r.photo.id),
  0,
)
  .slice(0, 5)
  .map((id) => byId.get(id)!);

type Lines = { features: { properties: { actor: string }; geometry: { coordinates: number[][] } }[] };

beforeEach(() => {
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup() {
  const game = gameFor(RECORDS);
  render(<Bullseye deck={game.deck} loadRecords={game.loadRecords} random={() => 0} />);
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  await screen.findByRole("button", { name: "Zoom in on the photo" });
  return map;
}

/** The rings drawn on the globe: whose each is, and its radius measured from `center`. */
function drawn(map: FakeMap) {
  return (map.sources.rings!.data as Lines).features.map((f) => f.properties.actor);
}

function ringRadius(map: FakeMap, i: number, center: { lng: number; lat: number }) {
  const [lng, lat] = (map.sources.rings!.data as Lines).features[i]!.geometry.coordinates[0]!;
  return haversineKm(center, { lng: lng!, lat: lat! });
}

describe("Bullseye", () => {
  it("needs a pin before a bet, starts on the 750 km ring and deals five photos", async () => {
    await setup();
    expect(screen.getByText("Bullseye: photo 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tap the globe to pin the photo" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^750 km/ })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(RINGS.length);
  });

  it("draws the ring around the pin, and redraws it as the bet changes by tap or key", async () => {
    const map = await setup();
    const at = { lng: 10, lat: 50 };
    act(() => map.click(at.lng, at.lat));
    expect(drawn(map)).toEqual(["player"]);
    expect(ringRadius(map, 0, at)).toBeCloseTo(750, 3);

    fireEvent.click(screen.getByRole("radio", { name: /^2,000 km/ }));
    expect(ringRadius(map, 0, at)).toBeCloseTo(2000, 3);
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByRole("radio", { name: /^250 km/ })).toBeChecked();
    expect(ringRadius(map, 0, at)).toBeCloseTo(250, 3);
    expect(screen.getByRole("button", { name: "Bet the 250 km ring for 1,000" })).toBeEnabled();
    // G bets even with focus left on the ring just tapped.
    const tapped = screen.getByRole("radio", { name: /^5,000 km/ });
    fireEvent.click(tapped);
    tapped.focus();
    fireEvent.keyDown(tapped, { key: "g" });
    expect(await screen.findByRole("region")).toHaveTextContent("You: ");
  });

  it("scores a photo inside the ring, shows Atlas's ring beside yours, and nothing outside", async () => {
    const map = await setup();
    const first = ORDER[0]!;
    act(() => map.click(first.lng + 1, first.lat));
    fireEvent.keyDown(window, { key: "g" });
    let card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Inside your ring");
    expect(within(card).getByRole("heading")).toHaveTextContent("500 points");
    expect(within(card).getByTestId("bullseye-you")).toHaveTextContent(
      /^You: Inside the 750 km ring, \d+ km off: 500 points\.$/,
    );
    expect(within(card).getByTestId("bullseye-atlas")).toHaveTextContent(
      "Atlas (dashed ring): Inside the 250 km ring, 0 m off: 1,000 points.",
    );
    expect(drawn(map)).toEqual(["player", "atlas"]);
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();

    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    // The ring bet last time is the next photo's starting bet.
    expect(screen.getByRole("radio", { name: /^750 km/ })).toBeChecked();
    expect(drawn(map)).toEqual([]);
    await screen.findByText("Bullseye: photo 2 of 5");
    await waitFor(() =>
      expect(document.querySelector("main")).toHaveAttribute("data-photo", ORDER[1]!.id),
    );
    // The far side of the world from the photo: outside any ring.
    act(() => map.click(ORDER[1]!.lng - 180, -ORDER[1]!.lat));
    fireEvent.click(screen.getByRole("radio", { name: /^5,000 km/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Bet the 5,000 km ring/ }));
    card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Outside your ring");
    expect(within(card).getByRole("heading")).toHaveTextContent("0 points");
    expect(screen.getByTestId("bullseye-score")).toHaveTextContent("500");
    // Each bet is tallied for Your calibration as it is placed: yours and Atlas's.
    const cal = loadFreeCalibration();
    expect(cal.you[1]).toEqual({ bet: 1, held: 1 });
    expect(cal.you[3]).toEqual({ bet: 1, held: 0 });
    // Atlas guessed both photos on the spot, sure of each: its tightest ring held twice.
    expect(cal.atlas[0]).toEqual({ bet: 2, held: 2 });
  });

  it("ends with the rings held, Atlas's total and a new best kept", async () => {
    const map = await setup();
    for (let i = 0; i < 5; i++) {
      await waitFor(() =>
        expect(document.querySelector("main")).toHaveAttribute("data-photo", ORDER[i]!.id),
      );
      act(() => map.click(ORDER[i]!.lng, ORDER[i]!.lat));
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      fireEvent.click(within(card).getByRole("button", { name: /Next photo|See your score/ }));
    }
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("2,500 points");
    expect(screen.getByText(/Your rings held 5 of 5 photos\./)).toHaveTextContent(
      "That's your new best!",
    );
    expect(screen.getByTestId("bullseye-atlas-total")).toHaveTextContent(
      "Atlas scored 5,000, holding 5 of 5 rings, 2,500 ahead of you.",
    );
    expect(localStorage.getItem(BEST_BULLSEYE_KEY)).toBe("2500");
    expect(within(screen.getByRole("list", { name: "Your photos" })).getAllByRole("listitem")).toHaveLength(5);
  });
});

function useClipboard() {
  const sent = { text: "" };
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (t: string) => void (sent.text = t) },
    configurable: true,
  });
  return sent;
}

describe("today's Bullseye", () => {
  const DAY = "2026-11-21";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const today = dailyBullseyeOrder(
    RECORDS.map((r) => r.photo.id),
    DAY,
  ).map((id) => byId.get(id)!);

  async function setupDay(remount = false) {
    const game = gameFor(RECORDS);
    const seen = FakeMap.instances.length;
    render(<Bullseye deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
    if (remount) await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(seen));
    else await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    const map = FakeMap.instances.at(-1)!;
    act(() => map.emit("load"));
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    return map;
  }

  const shownId = () => document.querySelector("main")!.getAttribute("data-photo");

  /** Pin `at` on the photo showing, bet `ring` (a radio's name) and go on from its answer. */
  async function play(map: FakeMap, at: { lng: number; lat: number }, ring: RegExp, last = false) {
    act(() => map.click(at.lng, at.lat));
    fireEvent.click(screen.getByRole("radio", { name: ring }));
    fireEvent.keyDown(window, { key: "g" });
    const card = await screen.findByRole("region");
    fireEvent.click(
      within(card).getByRole("button", { name: last ? "See your score" : "Next photo" }),
    );
  }

  it("deals the day's photos and picks up after a reload at the next photo, on the ring last bet", async () => {
    const map = await setupDay();
    await waitFor(() => expect(shownId()).toBe(today[0]!.id));
    expect(screen.getByText("Bullseye, today: photo 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/bullseye");
    // Kept the moment the bet is made, before its answer is read.
    act(() => map.click(today[0]!.lng, today[0]!.lat));
    fireEvent.click(screen.getByRole("radio", { name: /^250 km/ }));
    fireEvent.keyDown(window, { key: "g" });
    await screen.findByRole("region");
    expect(loadBullseyeDay(DAY)?.results).toMatchObject([
      { id: today[0]!.id, you: { ring: 0, inside: true, score: 1000 } },
    ]);
    // Your calibration reads today's bets from the kept day, so they are never tallied twice.
    expect(totals(loadFreeCalibration().you).bet).toBe(0);
    expect(loadCalibration().you[0]).toEqual({ bet: 1, held: 1 });

    cleanup();
    await setupDay(true);
    await waitFor(() => expect(shownId()).toBe(today[1]!.id));
    expect(screen.getByText("Bullseye, today: photo 2 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("bullseye-score")).toHaveTextContent("1,000");
    expect(screen.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  });

  it("ends in the day's result with a share of the rings, never dealt again, the free best untouched", async () => {
    const sent = useClipboard();
    window.history.replaceState(null, "", "/bullseye/daily");
    const map = await setupDay();
    for (const [i, photo] of today.slice(0, 5).entries()) {
      await waitFor(() => expect(shownId()).toBe(photo.id));
      // Every other photo pinned on the far side of the world, outside any ring.
      const at = i % 2 === 0 ? photo : { lng: photo.lng - 180, lat: -photo.lat };
      await play(map, at, /^2,000 km/, i === 4);
    }
    expect(await screen.findByRole("heading", { level: 1, name: "750 points" })).toBeInTheDocument();
    expect(
      screen.getByText(/^Out of 5,000\. Your rings held 3 of 5 photos\. Atlas scored 5,000.*next game is dealt/),
    ).toBeTruthy();
    const share = screen.getByRole("button", { name: "Share today's game" });
    expect(share).toHaveFocus();
    expect(screen.getByRole("list", { name: "Your photos" }).children).toHaveLength(5);
    expect(localStorage.getItem(BEST_BULLSEYE_KEY)).toBeNull();

    fireEvent.click(share);
    await waitFor(() => expect(sent.text).not.toBe(""));
    const lines = sent.text.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      `Whereabout · Bullseye · ${DAY}`,
      "🎯 750 of 5,000 · 3 of 5 rings held",
      "🟩 2,000 km  🟥 2,000 km  🟩 2,000 km  🟥 2,000 km  🟩 2,000 km",
      "Atlas: 5,000 · 5 of 5 rings held",
    ]);
    for (const photo of today) expect(sent.text).not.toContain(photo.place);

    cleanup();
    const game = gameFor(RECORDS);
    render(<Bullseye deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
    expect(await screen.findByRole("heading", { name: "750 points" })).toBeInTheDocument();
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("treats a day it can't read as not started", async () => {
    localStorage.setItem(BULLSEYE_DAILY_KEY, JSON.stringify({ [DAY]: { results: "no" } }));
    await setupDay();
    await waitFor(() => expect(shownId()).toBe(today[0]!.id));
    expect(screen.getByText("Bullseye, today: photo 1 of 5")).toBeInTheDocument();
  });

  it("links the free game to today's", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/bullseye/daily",
    );
  });
});

describe("a Bullseye challenge", () => {
  // The friend played p6, p1, p2, p3 and p4 in that order on the 250 km ring, 100 km off on
  // the first four and 6,000 km off the last: 4,000 points to beat.
  const LINKED = ["p6", "p1", "p2", "p3", "p4"].map((id) => byId.get(id)!);
  const FRIEND = "p6.p1.p2.p3.p4_11111_100.100.100.100.6000";

  afterEach(() => window.history.replaceState(null, "", "/"));

  const shownId = () => document.querySelector("main")!.getAttribute("data-photo");

  it("deals the friend's five, shows their ring once yours is bet, and sends yours back", async () => {
    const sent = useClipboard();
    window.history.replaceState(null, "", `/bullseye?challenge=${FRIEND}`);
    const map = await setup();
    expect(screen.getByTestId("bullseye-challenge")).toHaveTextContent(
      "A friend's challenge: 4,000 to beat",
    );
    expect(screen.queryByText("Best")).toBeNull();
    for (const [i, photo] of LINKED.entries()) {
      await waitFor(() => expect(shownId()).toBe(photo.id));
      expect(screen.getByTestId("bullseye-friend-score")).toHaveTextContent(
        ["0", "1,000", "2,000", "3,000", "4,000"][i]!,
      );
      act(() => map.click(photo.lng, photo.lat));
      fireEvent.click(screen.getByRole("radio", { name: /^250 km/ }));
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      expect(within(card).getByTestId("bullseye-friend")).toHaveTextContent(
        i < 4
          ? "Friend: Inside the 250 km ring, 100 km off: 1,000 points."
          : "Friend: Outside the 250 km ring, 6,000 km off: no points.",
      );
      fireEvent.click(within(card).getByRole("button", { name: /Next photo|See your score/ }));
    }
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("5,000 points");
    expect(screen.getByTestId("bullseye-challenge-line")).toHaveTextContent(
      "You beat your friend's 4,000 by 1,000.",
    );
    expect(screen.getAllByTestId("bullseye-row")[4]).toHaveTextContent(
      "Friend: outside the 250 km ring, 6,000 km off",
    );
    // A challenge's photos were picked by someone who had seen them: never a best.
    expect(localStorage.getItem(BEST_BULLSEYE_KEY)).toBeNull();
    expect(screen.queryByText(/new best/)).toBeNull();
    expect(screen.getByRole("button", { name: "Share head to head" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() => expect(sent.text).not.toBe(""));
    expect(sent.text.split("\n")).toEqual([
      "Whereabout · Bullseye: 5,000 points, 5 of 5 rings held.",
      "That beats your 4,000. Your turn to bet.",
      "http://localhost:3000/bullseye?challenge=p6.p1.p2.p3.p4_11111_0.0.0.0.0",
    ]);
    for (const photo of LINKED) expect(sent.text).not.toContain(photo.place);

    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    await waitFor(() => expect(screen.queryByTestId("bullseye-challenge")).toBeNull());
    expect(window.location.search).toBe("");
  });

  it.each([
    ["p6.p1.p2.p3_1111_1.2.3.4", "That challenge link was cut short, so here's a fresh game instead."],
    [
      "p6.p1.p2.p3.zz_11111_1.2.3.4.5",
      "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
    ],
  ])("sets the link %s aside for a fresh game", async (value, notice) => {
    window.history.replaceState(null, "", `/bullseye?challenge=${value}`);
    await setup();
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.queryByTestId("bullseye-challenge")).toBeNull();
    expect(window.location.search).toBe("");
    await waitFor(() => expect(shownId()).toBe(ORDER[0]!.id));
  });

  it("offers a whole free game to a friend", async () => {
    const sent = useClipboard();
    const map = await setup();
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(shownId()).toBe(ORDER[i]!.id));
      act(() => map.click(ORDER[i]!.lng, ORDER[i]!.lat));
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      expect(within(card).queryByTestId("bullseye-friend")).toBeNull();
      fireEvent.click(within(card).getByRole("button", { name: /Next photo|See your score/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(sent.text).not.toBe(""));
    expect(sent.text).toContain(
      `?challenge=${ORDER.map((p) => p.id).join(".")}_22222_0.0.0.0.0`,
    );
    expect(screen.queryByRole("button", { name: "Share head to head" })).toBeNull();
  });
});
