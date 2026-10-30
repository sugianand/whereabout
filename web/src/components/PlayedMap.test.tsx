import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYED_KEY, type PlayedPhoto } from "@/lib/playedMap";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import PlayedMap, { LIST_FIRST } from "./PlayedMap";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function photo(id: string, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: `Place ${id}`,
    country: "FR",
    km: 120,
    score: 4600,
    day: "2026-10-30",
    ...over,
  };
}

function store(history: PlayedPhoto[]) {
  window.localStorage.setItem(PLAYED_KEY, JSON.stringify(history));
}

beforeEach(() => {
  resetFakes();
  window.localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("PlayedMap", () => {
  it("asks for a first game when nothing has been played, and draws no globe", async () => {
    render(<PlayedMap />);
    expect(await screen.findByText(/Nothing on your map yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/");
    expect(FakeMap.instances).toHaveLength(0);
  });

  it("puts every played photo on the globe and counts what you've seen", async () => {
    store([
      photo("a", { country: "JP", km: 8, lng: 139.7, lat: 35.7, place: "Shibuya, Tokyo" }),
      photo("b", { country: "FR", km: 1200 }),
      photo("c", { country: "JP", km: null, score: 0 }),
    ]);
    render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));

    const dots = map.sources.played.data as { features: { properties: { band: string } }[] };
    expect(dots.features.map((f) => f.properties.band)).toEqual(["bullseye", "near", "far"]);

    const numbers = screen.getByLabelText("Your map in numbers");
    expect(within(numbers).getByText("Photos").nextSibling).toHaveTextContent("3");
    expect(within(numbers).getByText("Countries").nextSibling).toHaveTextContent("2");
    expect(within(numbers).getByText("Continents").nextSibling).toHaveTextContent("2");
    expect(screen.getByText(/Within 25 km/)).toHaveTextContent("Within 25 km: 1");
    expect(screen.getByText(/Further, or no pin/)).toHaveTextContent("Further, or no pin: 1");

    const countries = within(screen.getByRole("list", { name: "Countries you've seen" }));
    expect(countries.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Japan×2",
      "France",
    ]);

    // Newest first; a round with no pin says so.
    const rounds = within(screen.getByRole("list", { name: "Your rounds" })).getAllByRole("button");
    expect(rounds[0]).toHaveTextContent("No pin · 0 points");
    expect(rounds[2]).toHaveTextContent("Shibuya, Tokyo");
    expect(rounds[2]).toHaveTextContent("8.0 km off · 4,600 points");
  });

  it("flies to a round picked from the list and rings it", async () => {
    store([photo("a", { lng: 139.7, lat: 35.7, place: "Tokyo" }), photo("b")]);
    render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));

    fireEvent.click(screen.getByRole("button", { name: /Tokyo/ }));
    expect(screen.getByRole("button", { name: /Tokyo/ })).toHaveAttribute("aria-pressed", "true");
    expect(map.easeToCalls.at(-1)?.center).toEqual([139.7, 35.7]);
    const ring = map.sources["played-selected"].data as { features: unknown[] };
    expect(ring.features).toHaveLength(1);
  });

  it("lists the newest rounds first and the rest on request", async () => {
    store(Array.from({ length: LIST_FIRST + 3 }, (_, i) => photo(`p${i}`)));
    render(<PlayedMap />);
    const list = await screen.findByRole("list", { name: "Your rounds" });
    expect(within(list).getAllByRole("button")).toHaveLength(LIST_FIRST);
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent(`Place p${LIST_FIRST + 2}`);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${LIST_FIRST + 3}` }));
    expect(within(list).getAllByRole("button")).toHaveLength(LIST_FIRST + 3);
  });

  it("ignores a malformed stored history", async () => {
    window.localStorage.setItem(PLAYED_KEY, "{oops");
    render(<PlayedMap />);
    expect(await screen.findByText(/Nothing on your map yet/)).toBeInTheDocument();
  });
});
