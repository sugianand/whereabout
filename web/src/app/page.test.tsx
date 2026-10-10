import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

describe("Home", () => {
  it("lands the visitor straight in the game, not on a marketing page", () => {
    render(<Home />);
    expect(screen.getByText("Whereabout")).toBeInTheDocument();
    expect(screen.getByRole("application", { name: /Globe/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
  });
});
