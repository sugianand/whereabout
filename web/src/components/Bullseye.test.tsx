import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BEST_BULLSEYE_KEY, RINGS } from "@/lib/game/bullseye";
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
