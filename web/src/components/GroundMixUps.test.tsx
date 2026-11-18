import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { rememberGroundDay } from "@/lib/game/groundDaily";
import { BEST_GROUND_MIX_UPS_KEY, keepGroundCall } from "@/lib/game/groundMixUps";

import GroundMixUps from "./GroundMixUps";

const COUNTS = {
  "Built-up": 30,
  "Tree cover": 12,
  Grassland: 8,
  "Permanent water bodies": 2,
  "Bare / sparse vegetation": 2,
};

beforeEach(() => localStorage.clear());

describe("GroundMixUps", () => {
  it("shows nothing until a cover has been called wrong", () => {
    keepGroundCall("Grassland", "Grassland");
    const { container } = render(<GroundMixUps counts={COUNTS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the covers misread most, free games and today's, with a practice game", async () => {
    keepGroundCall("Grassland", "Tree cover");
    keepGroundCall("Grassland", "Grassland");
    keepGroundCall("Built-up", "Permanent water bodies");
    rememberGroundDay("2026-11-18", [
      { id: "g9", picked: "Tree cover", truth: "Grassland", correct: false, atlas: null },
    ]);
    localStorage.setItem(BEST_GROUND_MIX_UPS_KEY, "3");
    render(<GroundMixUps counts={COUNTS} />);
    expect(
      await screen.findByText(
        "From your last 4 calls in What's on the ground?, free games and today's.",
      ),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId("ground-misread");
    expect(rows.map((r) => r.dataset.cover)).toEqual(["Grassland", "Built-up"]);
    expect(within(rows[0]).getByText("2 of 3")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("You called 2 of 3 grassland photos wrong: trees twice.");
    expect(screen.getByRole("link", { name: "Practise these covers" })).toHaveAttribute(
      "href",
      "/on-the-ground/mix-ups",
    );
    expect(screen.getByTestId("ground-mix-ups-note")).toHaveTextContent(
      "Five photos, built-up, trees, grassland and water, dealt evenly. Your best: 3 of 5.",
    );
  });

  it("offers no practice game when its covers can't fill one", async () => {
    keepGroundCall("Permanent water bodies", "Bare / sparse vegetation");
    render(<GroundMixUps counts={COUNTS} />);
    expect(await screen.findByTestId("ground-misread")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Practise these covers" })).toBeNull();
  });
});
