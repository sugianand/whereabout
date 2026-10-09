import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

describe("Home", () => {
  it("names the product and explains it in one sentence", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Whereabout" })).toBeInTheDocument();
    expect(screen.getByText(/beat Atlas/)).toBeInTheDocument();
  });

  it("asks the player to place a pin on the globe", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Where was this taken?" })).toBeInTheDocument();
    expect(screen.getByRole("application")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Place your pin")).toBeInTheDocument();
  });
});
