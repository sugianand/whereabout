import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { BEST_WAY_KEY } from "@/lib/game/whichWay";
import { gameFor } from "@/test/deck";
import { FakeMap, FakeMarker, resetFakes } from "@/test/maplibre-mock";

import WhichWay from "./WhichWay";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function record(
  id: string,
  lng: number,
  lat: number,
  atlas: { lng: number; lat: number } | null,
): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng,
    lat,
    place: `Place ${id}`,
    country: "FR",
    credit: { author: `Author ${id}`, license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas: atlas && { ...atlas, confidence: 0.5, topCountries: [], clues: [] },
  };
}

// random() = 0 shuffles with seed 0, which deals p5, p3, p4, p1, p2: London, Paris, a Paris
// suburb (one city with Paris, so it is dealt again), Tokyo, New York.
const RECORDS = [
  record("p1", 139.69, 35.69, null),
  record("p2", -74.01, 40.71, { lng: -80, lat: 40 }),
  record("p3", 2.35, 48.86, { lng: 2.3, lat: 48.8 }),
  record("p4", 2.45, 48.9, null),
  record("p5", -0.13, 51.51, { lng: -0.1, lat: 51.5 }),
];

beforeEach(() => {
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<WhichWay deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(point("south-east")).toBeEnabled());
  return { loadRecords };
}

const point = (name: string) => screen.getByRole("button", { name: `Headed ${name}` });
const photo = (n: number) => screen.getByTestId(`way-photo-${n}`);
const card = () => screen.getByRole("region");

describe("WhichWay", () => {
  it("deals where you stand and where you're headed, with no place until a pick", async () => {
    const { loadRecords } = await setup();
    expect(photo(1)).toHaveAttribute("data-photo", "p5");
    expect(photo(2)).toHaveAttribute("data-photo", "p3");
    expect(photo(1)).toHaveTextContent("You are here");
    expect(photo(2)).toHaveTextContent("You're headed here");
    expect(screen.queryByText(/Place p/)).toBeNull();
    // Eight points, each with its number-pad key.
    const compass = screen.getByRole("group", { name: "Which way from photo 1 to photo 2?" });
    expect(within(compass).getAllByRole("button")).toHaveLength(8);
    expect(point("north")).toHaveAttribute("aria-keyshortcuts", "8");
    expect(point("south-west")).toHaveAttribute("aria-keyshortcuts", "1");
    // The globe waits, out of reach, until the reveal.
    expect(screen.getByTestId("way-globe")).toHaveAttribute("inert");
    expect(loadRecords.mock.calls.flat(2)).toEqual(["p5", "p3", "p4"]);
  });

  it("reveals the route, the bearing and Atlas's pick, then travels on past an unfit stop", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    const region = await screen.findByRole("region");
    expect(within(region).getByRole("heading")).toHaveTextContent("Right");
    expect(region).toHaveTextContent(
      /Place p3 is south-east of Place p5: the shortest route sets off at 148°, [\d,]+ (km|mi) away\./,
    );
    expect(region).toHaveTextContent(
      "Atlas picked south-east and got it. Atlas this run: 1 of 1 stop.",
    );
    // Both photos stay credited with the photos out of view.
    expect(
      within(region).getByRole("link", { name: "Photo 1: Author p5, CC BY 4.0" }),
    ).toHaveAttribute("href", "https://c/p5");
    expect(screen.getByTestId("way-globe")).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("way-compass")).toBeNull();
    expect(screen.getByText("Streak").nextElementSibling).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_WAY_KEY)).toBe("1");

    fireEvent.click(within(region).getByRole("button", { name: "Travel on" }));
    // Paris is where you stand now; the suburb is one city with it, so Tokyo is dealt instead.
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p1"));
    expect(photo(1)).toHaveAttribute("data-photo", "p3");
    await waitFor(() => expect(point("north-east")).toBeEnabled());
  });

  it("teaches the great circle: Paris to Tokyo looks east on a map but sets off north-east", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p1"));
    await waitFor(() => expect(point("north-east")).toBeEnabled());
    // 9 is north-east on the number pad.
    fireEvent.keyDown(window, { key: "9" });
    const region = await screen.findByRole("region");
    expect(within(region).getByRole("heading")).toHaveTextContent("Right");
    expect(region).toHaveTextContent(
      "On a flat map it looks east, but the globe's shortest route heads north-east.",
    );
    // Atlas never guessed Tokyo, so it sits this stop out.
    expect(region).not.toHaveTextContent(/Atlas picked/);
  });

  it("ends the run on the first wrong pick and keeps the best", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(point("north-east")).toBeEnabled());
    fireEvent.click(point("north-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p2"));
    await waitFor(() => expect(point("south")).toBeEnabled());
    fireEvent.click(point("south"));
    expect(within(card()).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card()).toHaveTextContent("You picked south.");
    expect(card()).toHaveTextContent("Run over: 2 stops in a row. That's your new best!");
    expect(localStorage.getItem(BEST_WAY_KEY)).toBe("2");

    fireEvent.click(within(card()).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(point("south-east")).toBeEnabled());
    expect(screen.getByText("Streak").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("2");
  });

  it("draws the route on the globe at the reveal: pin 1 where you stood, gold where you were headed", async () => {
    await setup();
    await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));
    fireEvent.click(point("south-east"));
    await screen.findByRole("region");
    // Reduced motion (matchMedia matches): the whole route is drawn at once.
    await waitFor(() => expect(map.jumpToCalls.length).toBeGreaterThan(0));
    const lines = map.sources.reveal.data as {
      features: { geometry: { coordinates: [number, number][] } }[];
    };
    expect(lines.features).toHaveLength(1);
    const route = lines.features[0].geometry.coordinates;
    expect(route[0][0]).toBeCloseTo(-0.13, 6);
    expect(route[0][1]).toBeCloseTo(51.51, 6);
    expect(route.at(-1)![0]).toBeCloseTo(2.35, 6);
    expect(route.at(-1)![1]).toBeCloseTo(48.86, 6);
    const placed = FakeMarker.instances.filter((m) => m.map === map);
    expect(placed.find((m) => m.element.textContent === "1")?.lngLat).toEqual([-0.13, 51.51]);
    expect(placed.find((m) => m.element.classList.contains("globe-pin--truth"))?.lngLat).toEqual([
      2.35, 48.86,
    ]);
  });
});
