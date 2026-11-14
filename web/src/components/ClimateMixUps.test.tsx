import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { rememberClimateDay } from "@/lib/game/climateDaily";
import { BEST_CLIMATE_MIX_UPS_KEY, keepClimateCall } from "@/lib/game/climateMixUps";

import ClimateMixUps from "./ClimateMixUps";

const COUNTS = { Tropical: 2, Arid: 6, Temperate: 30, Continental: 20, Polar: 2 };

beforeEach(() => localStorage.clear());

describe("ClimateMixUps", () => {
  it("shows nothing until a climate has been called wrong", () => {
    keepClimateCall("Arid", "Arid");
    const { container } = render(<ClimateMixUps counts={COUNTS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the climates misread most, free games and today's, with a practice game", async () => {
    keepClimateCall("Continental", "Temperate");
    keepClimateCall("Continental", "Continental");
    keepClimateCall("Arid", "Tropical");
    rememberClimateDay("2026-11-14", [
      { id: "c9", picked: "Temperate", truth: "Continental", correct: false, atlas: null },
    ]);
    localStorage.setItem(BEST_CLIMATE_MIX_UPS_KEY, "3");
    render(<ClimateMixUps counts={COUNTS} />);
    expect(
      await screen.findByText("From your last 4 calls in Which climate?, free games and today's."),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId("climate-misread");
    expect(rows.map((r) => r.dataset.group)).toEqual(["Continental", "Arid"]);
    expect(within(rows[0]).getByText("2 of 3")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(
      "You called 2 of 3 continental photos wrong: temperate twice.",
    );
    expect(screen.getByRole("link", { name: "Practise these climates" })).toHaveAttribute(
      "href",
      "/which-climate/mix-ups",
    );
    expect(screen.getByTestId("climate-mix-ups-note")).toHaveTextContent(
      "Five photos, tropical, arid, temperate and continental, dealt evenly. Your best: 3 of 5.",
    );
  });

  it("offers no practice game when its climates can't fill one", async () => {
    keepClimateCall("Polar", "Tropical");
    render(<ClimateMixUps counts={COUNTS} />);
    expect(await screen.findByTestId("climate-misread")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Practise these climates" })).toBeNull();
  });
});
