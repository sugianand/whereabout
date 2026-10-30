import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { PASS_PLAYERS_KEY, PASS_ROUNDS } from "@/lib/game/passPlay";
import type { CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";
import { FakeMap, FakeMarker, resetFakes } from "@/test/maplibre-mock";

import PassAndPlay from "./PassAndPlay";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function record(id: string, lng: number, lat: number): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    lng,
    lat,
    place: `Somewhere ${id}`,
    country: "FR",
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  // Atlas always guesses Paris.
  return {
    photo,
    atlas: { lng: 2.35, lat: 48.86, confidence: 0.6, topCountries: [], clues: [] },
  };
}

const RECORDS = [
  record("p1", 2.35, 48.86),
  record("p2", 139.69, 35.69),
  record("p3", -47.88, -15.79),
  record("p4", 151.21, -33.87),
  record("p5", -74.0, 40.71),
  record("p6", 31.24, 30.04),
];
const byId = new Map(RECORDS.map((r) => [r.photo.id, r.photo]));
// random() = 0 deals with seed 0.
const ORDER = seededShuffle(
  RECORDS.map((r) => r.photo.id),
  0,
)
  .slice(0, PASS_ROUNDS)
  .map((id) => byId.get(id)!);

const antipode = (p: CatalogPhoto) => ({ lng: p.lng > 0 ? p.lng - 180 : p.lng + 180, lat: -p.lat });

beforeEach(() => {
  window.history.replaceState(null, "", "/pass-and-play");
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<PassAndPlay deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  return { loadRecords };
}

async function startWith(names: string[]) {
  for (let i = 2; i < names.length; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
  }
  names.forEach((name, i) =>
    fireEvent.change(screen.getByRole("textbox", { name: `Player ${i + 1} name` }), {
      target: { value: name },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start the game" }));
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  return map;
}

/** Takes the device as `name`, pins `at` and locks it in. */
async function turn(map: FakeMap, name: string, at: { lng: number; lat: number }) {
  fireEvent.click(screen.getByRole("button", { name: `I'm ${name}, show the photo` }));
  await screen.findByRole("button", { name: "Zoom in on the photo" });
  act(() => map.click(at.lng, at.lat));
  fireEvent.click(screen.getByRole("button", { name: "Lock in my pin" }));
}

/** Who the pass screen is waiting for. */
const passedTo = () =>
  screen
    .getByRole("heading", { name: /^Pass to / })
    .textContent!.replace("Pass to", "")
    .trim();

const card = () => screen.getByRole("region", { name: (n) => n.startsWith("Somewhere") });

describe("PassAndPlay", () => {
  it("starts with two name fields, takes up to four, and needs at least two", () => {
    setup();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Remove player/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Add a player" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove player 3" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });

  it("hides the last pin between turns, then reveals every pin and the table", async () => {
    setup();
    const map = await startWith(["Ana", "Bo"]);

    expect(screen.getByRole("heading", { name: "Pass to Ana" })).toBeInTheDocument();
    await turn(map, "Ana", ORDER[0]);
    // Bo's screen: nothing of Ana's pin is on the globe.
    expect(screen.getByRole("heading", { name: "Pass to Bo" })).toBeInTheDocument();
    expect(screen.getByText(/The last pin is hidden/)).toBeInTheDocument();
    expect(FakeMarker.instances.filter((m) => m.map)).toHaveLength(0);
    await turn(map, "Bo", antipode(ORDER[0]));

    const reveal = card();
    expect(within(reveal).getByText("Closest: Ana")).toBeInTheDocument();
    const rows = within(reveal).getAllByRole("row").slice(1);
    // Ana first with a perfect 5,000, then Atlas, then Bo on 0.
    expect(rows.map((r) => r.querySelector("th")!.textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Atlas"),
      expect.stringContaining("Bo"),
    ]);
    expect(rows[0]).toHaveTextContent(/0 m · 5,000\s*5,000/);
    // Both seats get a numbered pin, beside Atlas's.
    const labels = FakeMarker.instances
      .filter((m) => m.map)
      .map((m) => m.element.querySelector(".globe-pin__label")?.textContent ?? m.element.className);
    expect(labels).toEqual(expect.arrayContaining(["1", "2", "globe-pin globe-pin--atlas"]));
    expect(within(reveal).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("moves the first turn on each round and ends on a final table", async () => {
    setup();
    const map = await startWith(["Ana", "Bo", "Cy"]);
    const firsts: string[] = [];
    for (let r = 0; r < PASS_ROUNDS; r++) {
      firsts.push(passedTo());
      for (let t = 0; t < 3; t++) {
        const name = passedTo();
        // Cy always nails it; the others are on the far side of the world.
        await turn(map, name, name === "Cy" ? ORDER[r] : antipode(ORDER[r]));
      }
      fireEvent.click(
        within(card()).getByRole("button", {
          name: r === PASS_ROUNDS - 1 ? "See the final table" : "Next photo",
        }),
      );
    }
    expect(firsts).toEqual(["Ana", "Bo", "Cy", "Ana", "Bo"]);
    expect(screen.getByRole("heading", { name: "Cy wins!" })).toBeInTheDocument();
    expect(screen.getByText(/^The table beat Atlas, who scored [\d,]+\.$/)).toBeInTheDocument();
    const table = within(screen.getByRole("list", { name: "Final table" })).getAllByRole(
      "listitem",
    );
    expect(table[0]).toHaveTextContent(/Cy\s*25,000/);
    expect(JSON.parse(localStorage.getItem(PASS_PLAYERS_KEY)!)).toEqual(["Ana", "Bo", "Cy"]);

    // Change players goes back to the names, kept.
    fireEvent.click(screen.getByRole("button", { name: "Change players" }));
    expect(screen.getByRole("textbox", { name: "Player 3 name" })).toHaveValue("Cy");
  });

  it("prefills the last table's names", async () => {
    localStorage.setItem(PASS_PLAYERS_KEY, JSON.stringify(["Ana", "Bo", "Cy"]));
    setup();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Player 3 name" })).toHaveValue("Cy"),
    );
  });

  it("fetches only the photo on screen and the next one", async () => {
    const { loadRecords } = setup();
    await startWith(["Ana", "Bo"]);
    await waitFor(() => expect(loadRecords).toHaveBeenCalled());
    const asked = loadRecords.mock.calls.flatMap(([ids]) => ids);
    expect(asked).toEqual(ORDER.slice(0, 2).map((p) => p.id));
  });
});
