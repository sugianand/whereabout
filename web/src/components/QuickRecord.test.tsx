import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CLUE_DAILY_KEY } from "@/lib/game/clueDaily";
import { GROUND_DAILY_KEY } from "@/lib/game/groundDaily";
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

    const road = within(section).getByTestId("record-road");
    expect(within(road).getByRole("heading", { name: "The road" })).toBeVisible();
    expect(within(road).getByText("2 Left or right? runs, 1 of them today's")).toBeInTheDocument();
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
    expect(within(road).getByRole("link", { name: "Today's Left or right?" })).toHaveAttribute(
      "href",
      "/left-right/daily",
    );
    expect(within(road).getByRole("link", { name: "Play Clue mix" })).toHaveAttribute(
      "href",
      "/clue-mix",
    );

    const climate = within(section).getByTestId("record-climate");
    expect(within(climate).getByRole("heading", { name: "The climate" })).toBeVisible();
    expect(within(climate).getByText("1 Which climate? game")).toBeInTheDocument();
    expect(within(climate).getByText("Atlas is ahead of you by 100 points.")).toBeInTheDocument();
    expect(within(climate).getByRole("link", { name: "Play Which climate?" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    // Clue mix hasn't been played, so nothing reads the continent yet.
    expect(within(section).queryByTestId("record-continent")).not.toBeInTheDocument();
  });

  it("counts Clue mix's calls under each clue, the continent in a card of its own", async () => {
    recordFreeRound("left-right", { first: true, correct: true, atlas: true });
    recordFreeRound("clue-mix-road", { first: true, correct: true, atlas: null });
    recordFreeRound("clue-mix-climate", { first: true, correct: true, atlas: true });
    recordFreeRound("clue-mix-continent", { first: true, correct: false, atlas: true });
    // Today's run: the road right, the climate missed; Atlas read only the climate, wrongly.
    window.localStorage.setItem(
      CLUE_DAILY_KEY,
      JSON.stringify({
        "2026-11-16": { streak: 1, atlasRight: 0, atlasPlayed: 1, ended: "miss", reads: "-w" },
      }),
    );
    render(<QuickRecord />);
    const section = await screen.findByTestId("clue-reading");

    const road = within(section).getByTestId("record-road");
    expect(within(road).getByTestId("record-road-left-right")).toHaveTextContent(
      "1 Left or right? run",
    );
    expect(within(road).getByTestId("record-road-clue-mix-road")).toHaveTextContent(
      "2 Clue mix runs, 1 of them today's",
    );
    // You: 3 of 3 (Left or right?, a free Clue mix call and today's); Atlas read only the first.
    expect(within(road).getByTestId("record-road-you")).toHaveAttribute("data-played", "3");
    expect(within(road).getByTestId("record-road-atlas")).toHaveAttribute("data-played", "1");

    const climate = within(section).getByTestId("record-climate");
    // No Which climate? game was played, so only Clue mix is listed for the climate.
    expect(within(climate).queryByTestId("record-climate-which-climate")).toBeNull();
    expect(within(climate).getByTestId("record-climate-you")).toHaveAttribute("data-right", "1");
    expect(within(climate).getByTestId("record-climate-you")).toHaveAttribute("data-played", "2");
    expect(within(climate).getByTestId("record-climate-atlas")).toHaveAttribute("data-right", "1");

    const continent = within(section).getByTestId("record-continent");
    expect(within(continent).getByRole("heading", { name: "The continent" })).toBeVisible();
    expect(within(continent).getByText("Atlas is ahead of you by 100 points.")).toBeInTheDocument();
    expect(within(continent).getByRole("link", { name: "Today's Clue mix" })).toHaveAttribute(
      "href",
      "/clue-mix/daily",
    );
    expect(within(continent).queryByRole("link", { name: /Left or right/ })).toBeNull();
  });

  it("counts What's on the ground? with Clue mix's ground steps, with a way into today's game", async () => {
    recordFreeRound("on-the-ground", { first: true, correct: true, atlas: true });
    recordFreeRound("on-the-ground", { first: false, correct: true, atlas: null });
    recordFreeRound("clue-mix-ground", { first: true, correct: false, atlas: false });
    window.localStorage.setItem(
      GROUND_DAILY_KEY,
      JSON.stringify({
        "2026-11-19": {
          results: [
            { id: "a", picked: "Built-up", truth: "Built-up", correct: true, atlas: "Built-up" },
            { id: "b", picked: "Grassland", truth: "Tree cover", correct: false, atlas: null },
          ],
        },
      }),
    );
    render(<QuickRecord />);
    const section = await screen.findByTestId("clue-reading");
    const ground = within(section).getByTestId("record-ground");
    expect(within(ground).getByRole("heading", { name: "The ground" })).toBeVisible();
    expect(within(ground).getByTestId("record-ground-on-the-ground")).toHaveTextContent(
      "2 What's on the ground? games, 1 of them today's",
    );
    expect(within(ground).getByTestId("record-ground-clue-mix-ground")).toHaveTextContent(
      "1 Clue mix run",
    );
    // You: 3 of 5 photos (60%); Atlas: 2 of the 3 it read (67%).
    expect(within(ground).getByTestId("record-ground-you")).toHaveAttribute("data-right", "3");
    expect(within(ground).getByTestId("record-ground-you")).toHaveAttribute("data-played", "5");
    expect(within(ground).getByTestId("record-ground-atlas")).toHaveAttribute("data-right", "2");
    expect(within(ground).getByTestId("record-ground-atlas")).toHaveAttribute("data-played", "3");
    expect(within(ground).getByText("Atlas is ahead of you by 7 points.")).toBeInTheDocument();
    expect(
      within(ground).getByText(
        /named a city, a skyline or a coast, so it has played 2 photos fewer/,
      ),
    ).toBeInTheDocument();
    expect(
      within(ground).getByRole("link", { name: "Today's What's on the ground?" }),
    ).toHaveAttribute("href", "/on-the-ground/daily");
    expect(
      within(ground).getByRole("link", { name: "Play What's on the ground?" }),
    ).toHaveAttribute("href", "/on-the-ground");
    // Neither game reads the climate, so it has no card.
    expect(within(section).queryByTestId("record-climate")).not.toBeInTheDocument();
  });

  it("shows both sections when both kinds of game have been played", async () => {
    recordFreeRound("odd-one-out", { first: true, correct: true, atlas: true });
    recordFreeRound("which-climate", { first: true, correct: true, atlas: null });
    render(<QuickRecord />);
    expect(await screen.findByTestId("clue-reading")).toBeInTheDocument();
    expect(screen.getByTestId("quick-record")).toBeInTheDocument();
    expect(screen.queryByTestId("record-road")).not.toBeInTheDocument();
  });
});
