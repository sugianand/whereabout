import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bundledDeck } from "@/lib/game/bundled";

import Home from "./page";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

afterEach(() => vi.unstubAllGlobals());

describe("Home", () => {
  it("lands the visitor straight in the game, not on a marketing page", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<Home />);
    expect(screen.getByText("Whereabout")).toBeInTheDocument();
    expect(screen.getByRole("application", { name: /Globe/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
  });

  it("deals from the photos Atlas has guessed", () => {
    expect(bundledDeck.ids.length).toBeGreaterThanOrEqual(5);
    expect(new Set(bundledDeck.ids).size).toBe(bundledDeck.ids.length);
  });
});
