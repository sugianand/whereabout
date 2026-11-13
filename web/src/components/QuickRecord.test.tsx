import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { NORTH_DAILY_KEY } from "@/lib/game/northDaily";
import { recordFreeRound } from "@/lib/game/quickRecord";
import { SIDE_DAILY_KEY } from "@/lib/game/sideDaily";

import QuickRecord from "./QuickRecord";

beforeEach(() => {
  window.localStorage.clear();
});

describe("QuickRecord", () => {
  it("shows nothing until a quick-game round has been played", () => {
    const { container } = render(<QuickRecord />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the games played, you against Atlas, with today's runs counted in", async () => {
    recordFreeRound("further-north", { first: true, correct: true, atlas: true });
    recordFreeRound("further-north", { first: false, correct: false, atlas: null });
    window.localStorage.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify({
        "2026-10-31": { streak: 2, atlasRight: 0, atlasPlayed: 2, ended: "miss" },
      }),
    );
    render(<QuickRecord />);
    const card = await screen.findByTestId("record-further-north");
    expect(screen.queryByTestId("record-odd-one-out")).not.toBeInTheDocument();
    expect(within(card).getByText("2 runs, 1 of them today's")).toBeInTheDocument();
    // You: 3 of 5 right (60%); Atlas: 1 of the 3 it played (33%).
    expect(within(card).getByText("You're ahead of Atlas by 27 points.")).toBeInTheDocument();
    const you = within(card).getByRole("meter", { name: "You: rounds right" });
    expect(you).toHaveAttribute("aria-valuenow", "60");
    expect(you).toHaveAttribute("aria-valuetext", "3 of 5 rounds right, 60%");
    const atlas = within(card).getByRole("meter", { name: "Atlas: rounds right" });
    expect(atlas).toHaveAttribute("aria-valuetext", "1 of 3 rounds right, 33%");
    expect(within(card).getByText(/it has played 2 rounds fewer than you/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Play Further North" })).toHaveAttribute(
      "href",
      "/further-north",
    );
    expect(within(card).getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/further-north/daily",
    );
  });

  it("waits for Atlas's first round before calling a leader", async () => {
    recordFreeRound("odd-one-out", { first: true, correct: true, atlas: null });
    render(<QuickRecord />);
    const card = await screen.findByTestId("record-odd-one-out");
    expect(within(card).getByText("Atlas hasn't played a round with you yet.")).toBeInTheDocument();
    expect(within(card).getByText("1 run")).toBeInTheDocument();
    expect(within(card).getByText("No rounds yet")).toBeInTheDocument();
  });

  it("reads the clue games apart as your clue reading, in photos, the road with its daily", async () => {
    recordFreeRound("left-right", { first: true, correct: true, atlas: true });
    recordFreeRound("left-right", { first: false, correct: false, atlas: null });
    window.localStorage.setItem(
      SIDE_DAILY_KEY,
      JSON.stringify({
        "2026-11-13": { streak: 1, atlasRight: 0, atlasPlayed: 1, ended: "miss" },
      }),
    );
    recordFreeRound("which-climate", { first: true, correct: false, atlas: true });
    render(<QuickRecord />);
    const section = await screen.findByTestId("clue-reading");
    expect(
      within(section).getByRole("heading", { level: 2, name: "Your clue reading" }),
    ).toBeInTheDocument();
    // No picking game has been played, so only the clue reading shows.
    expect(screen.queryByTestId("quick-record")).not.toBeInTheDocument();

    const road = within(section).getByTestId("record-left-right");
    expect(within(road).getByRole("heading", { name: "Left or right?" })).toBeVisible();
    expect(within(road).getByText("The road")).toBeVisible();
    expect(within(road).getByText("2 runs, 1 of them today's")).toBeInTheDocument();
    // You: 2 of 4 photos (50%); Atlas: 1 of the 2 it read (50%).
    expect(within(road).getByText("You and Atlas are level.")).toBeInTheDocument();
    expect(within(road).getByRole("meter", { name: "You: photos right" })).toHaveAttribute(
      "aria-valuetext",
      "2 of 4 photos right, 50%",
    );
    expect(
      within(road).getByText(
        /said nothing about the road or the country, so it has played 2 photos fewer/,
      ),
    ).toBeInTheDocument();
    expect(within(road).getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/left-right/daily",
    );

    const climate = within(section).getByTestId("record-which-climate");
    expect(within(climate).getByRole("heading", { name: "Which climate?" })).toBeVisible();
    expect(within(climate).getByText("The climate")).toBeVisible();
    expect(within(climate).getByText("1 game")).toBeInTheDocument();
    expect(within(climate).getByText("Atlas is ahead of you by 100 points.")).toBeInTheDocument();
    expect(within(climate).getByRole("link", { name: "Play Which climate?" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    // Which climate? has no daily to link to.
    expect(within(climate).queryByRole("link", { name: "Today's run" })).toBeNull();
  });

  it("shows both sections when both kinds of game have been played", async () => {
    recordFreeRound("odd-one-out", { first: true, correct: true, atlas: true });
    recordFreeRound("which-climate", { first: true, correct: true, atlas: null });
    render(<QuickRecord />);
    expect(await screen.findByTestId("clue-reading")).toBeInTheDocument();
    expect(screen.getByTestId("quick-record")).toBeInTheDocument();
    expect(screen.queryByTestId("record-left-right")).not.toBeInTheDocument();
  });
});
