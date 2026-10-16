import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import catalog from "@/data/photos.json";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Game from "./Game";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

// Atlas has guessed only five photos: the rest stand for photos just merged from the harvest,
// which wait in the catalog until the Atlas workflow has guessed them too.
const GUESSED = catalog.slice(-5).map((p) => p.id);
vi.mock("@/data/atlas.json", async () => {
  const { default: photos } = await import("@/data/photos.json");
  const guess = { lat: 0, lng: 0, place: "Somewhere", confidence: 0.5, clues: [] };
  return {
    default: {
      model: "test",
      version: "test",
      generatedAt: "2026-10-16T00:00:00Z",
      guesses: Object.fromEntries(photos.slice(-5).map((p) => [p.id, guess])),
    },
  };
});

beforeEach(() => {
  resetFakes();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Game deals only photos Atlas has guessed", () => {
  it.each(["daily", "fresh"] as const)("in a %s game", async (start) => {
    render(<Game start={start} today={new Date("2026-10-16T12:00:00Z")} />);
    await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    act(() => FakeMap.instances.at(-1)!.emit("load"));
    const img = await screen.findByRole("img", {}, { timeout: 4000 });
    const shown = catalog.find((p) => p.imageUrl === img.getAttribute("src"));
    expect(shown && GUESSED.includes(shown.id)).toBe(true);
  });
});
