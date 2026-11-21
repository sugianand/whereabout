import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { settleBet } from "@/lib/game/bullseye";
import { recordBullseyeRound } from "@/lib/game/bullseyeCalibration";
import { rememberBullseyeDay } from "@/lib/game/bullseyeDaily";

import BullseyeCalibration from "./BullseyeCalibration";

const AT = { lng: 0, lat: 0 };

beforeEach(() => window.localStorage.clear());

describe("BullseyeCalibration", () => {
  it("shows nothing until a photo has been bet on", () => {
    const { container } = render(<BullseyeCalibration />);
    expect(container).toBeEmptyDOMElement();
  });

  it("charts each ring's bets held for you and Atlas, today's games counted in", async () => {
    recordBullseyeRound({ id: "a", you: settleBet(AT, 0, 100), atlas: settleBet(AT, 0, 400) });
    recordBullseyeRound({ id: "b", you: settleBet(AT, 0, 600), atlas: null });
    rememberBullseyeDay("2026-11-21", [
      { id: "c", you: settleBet(AT, 3, 3000), atlas: settleBet(AT, 1, 700) },
    ]);
    render(<BullseyeCalibration />);
    expect(await screen.findByTestId("calibration-line")).toHaveTextContent(
      "Your rings held 2 of 3 photos (67%); Atlas's held 1 of 2 (50%).You hold your rings more often than Atlas.",
    );
    const chart = screen.getByRole("list", { name: "Rings held against rings bet" });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(4);
    const tight = screen.getByTestId("calibration-ring-0");
    expect(within(tight).getByRole("meter", { name: "You: the 250 km ring held" })).toHaveAttribute(
      "aria-valuetext",
      "1 of 2 held · 50%",
    );
    expect(
      within(tight).getByRole("meter", { name: "Atlas: the 250 km ring held" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("calibration-ring-1-atlas")).toHaveTextContent("1 of 1 held · 100%");
    expect(screen.getByTestId("calibration-ring-2-you")).toHaveTextContent("Not bet yet");
    expect(screen.getByRole("link", { name: "Play Bullseye" })).toHaveAttribute("href", "/bullseye");
  });
});
