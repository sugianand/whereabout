import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import type { AtlasData } from "@/lib/game/types";

import { systemLabel } from "@/lib/atlas";

import AtlasPage from "./page";

const atlas = atlasData as AtlasData;

describe("How Atlas guesses", () => {
  it("walks through the three steps in order", () => {
    render(<AtlasPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "How Atlas guesses" }),
    ).toBeInTheDocument();
    const steps = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(steps.slice(0, 3)).toEqual(["Read the photo", "Pick a country", "Pick a city"]);
  });

  it("shows the results of the run that made the guesses, or says they are coming", () => {
    render(<AtlasPage />);
    const systems = atlas.evaluation?.systems ?? [];
    if (systems.length === 0) {
      expect(screen.getByText(/appears here after Atlas's next run/)).toBeInTheDocument();
      return;
    }
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(systems.length + 1);
    const playing = systems.filter((s) => s.playsInGame);
    expect(playing).toHaveLength(1);
    expect(within(table).getByText("The Atlas you play against")).toBeInTheDocument();
  });

  it("links back to the game", () => {
    render(<AtlasPage />);
    expect(screen.getByRole("link", { name: "Play today's five" })).toHaveAttribute("href", "/");
  });
});

describe("systemLabel", () => {
  it("turns model ids into readable names", () => {
    expect(systemLabel("ViT-L-14/openai, country then city")).toBe(
      "CLIP ViT-L/14 (OpenAI), country then city",
    );
    expect(systemLabel("Random city (baseline)")).toBe("Random city");
  });
});
