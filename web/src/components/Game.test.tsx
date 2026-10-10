import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { LocalBackend } from "@/lib/game/backends";
import { pickDaily } from "@/lib/game/daily";
import { ROUNDS_PER_GAME } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto, GameBackend } from "@/lib/game/types";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Game, { modeTitle } from "./Game";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const TODAY = new Date("2026-10-09T15:00:00Z");
const daily = pickDaily(catalog as CatalogPhoto[], "2026-10-09", ROUNDS_PER_GAME);

beforeEach(() => {
  resetFakes();
  // Reduced motion: the reveal and count-ups jump straight to their final values.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia; remove the stub between tests.
  delete window.matchMedia;
});

async function mapReady() {
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  return map;
}

// Generous waits: a five-round game is many renders, and CI machines are slow and busy.
const WAIT = { timeout: 4000 };

async function playRound(map: FakeMap, at: { lng: number; lat: number }) {
  await screen.findByRole("button", { name: "Zoom in on the photo" }, WAIT);
  act(() => map.click(at.lng, at.lat));
  fireEvent.click(screen.getByRole("button", { name: "Guess here" }));
  return screen.findByRole("region", { name: /./ }, WAIT);
}

describe("Game", { timeout: 20000 }, () => {
  it("titles the game with today's date", () => {
    expect(modeTitle({ kind: "daily", day: "2026-10-09" })).toBe("Daily Five, October 9");
    expect(modeTitle({ kind: "practice", game: 2 })).toBe("Practice game");
  });

  it("needs a pin before the player can guess", async () => {
    render(<Game today={TODAY} />);
    await mapReady();
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
  });

  it("shows today's first photo, and reveals the place, distance and credit after a guess", async () => {
    render(<Game today={TODAY} />);
    const map = await mapReady();
    const first = daily[0];

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", first.imageUrl);

    const card = await playRound(map, first);
    expect(within(card).getByRole("heading", { name: first.place })).toBeInTheDocument();
    const announced = within(card).getByText(/^You were 0 m away and scored 5,000 points\./);
    const atlasGuess = (atlasData as AtlasData).guesses[first.id];
    if (atlasGuess) {
      // Atlas played this photo: its distance and the verdict are announced too.
      expect(announced).toHaveTextContent(/Atlas was .+ away and scored [\d,]+\./);
      expect(announced).toHaveTextContent(/(You beat Atlas|Atlas got closer|A dead heat)/);
    } else {
      expect(announced).toHaveTextContent(/^You were 0 m away and scored 5,000 points\.$/);
    }
    expect(
      within(card).getByRole("link", { name: new RegExp(first.credit.author) }),
    ).toHaveAttribute("href", first.credit.sourceUrl);
    // Focus moves in a passive effect, which can flush just after the card reaches the DOM.
    const next = within(card).getByRole("button", { name: "Next photo" });
    await waitFor(() => expect(next).toHaveFocus());
  });

  it("plays five rounds and ends on a summary with every place", async () => {
    render(<Game today={TODAY} />);
    const map = await mapReady();

    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const card = await playRound(map, { lng: 0, lat: 0 });
      const last = i === ROUNDS_PER_GAME - 1;
      fireEvent.click(
        within(card).getByRole("button", { name: last ? "See your results" : "Next photo" }),
      );
    }

    expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
    for (const photo of daily) expect(screen.getByText(photo.place)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
  });

  it("keeps the pin and explains the problem when a guess fails", async () => {
    const failing = (photos: CatalogPhoto[]): GameBackend => {
      const local = new LocalBackend(photos);
      return {
        kind: "api",
        startRound: () => local.startRound(),
        guess: () => Promise.reject(new Error("The game server answered 503. Try again.")),
      };
    };
    render(<Game today={TODAY} backendFor={failing} />);
    const map = await mapReady();
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    act(() => map.click(10, 10));
    fireEvent.click(screen.getByRole("button", { name: "Guess here" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("503");
    expect(screen.getByRole("button", { name: "Guess here" })).toBeEnabled();
  });

  it("starts a different practice game after the daily one", async () => {
    render(<Game today={TODAY} />);
    const map = await mapReady();
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const card = await playRound(map, { lng: 0, lat: 0 });
      fireEvent.click(within(card).getAllByRole("button")[0]);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Play a practice game" }, WAIT));
    expect(await screen.findByText("Practice game", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
  });
});
