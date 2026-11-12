import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MIN_FORM_ROUNDS } from "@/lib/continentForm";
import type { PlayedPhoto } from "@/lib/playedMap";
import { UNITS_KEY } from "@/lib/units";

import ContinentForm from "./ContinentForm";

let n = 0;
const rounds = (country: string, kms: (number | null)[]): PlayedPhoto[] =>
  kms.map((km) => {
    n += 1;
    return {
      id: `p${n}`,
      lng: 0,
      lat: 0,
      place: `Place ${n}`,
      country,
      km,
      score: 3000,
      day: "2026-11-01",
    };
  });

const ranked = (country: string, km: number) => rounds(country, Array(MIN_FORM_ROUNDS).fill(km));

const REGIONS = { Europe: ["a"], Oceania: ["b"], Asia: ["c"] };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(UNITS_KEY, "km");
});

describe("ContinentForm", () => {
  it("shows nothing before a round on any continent", () => {
    const { container } = render(<ContinentForm played={[]} regions={REGIONS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each continent's median and names the weak spot with a game to practise", () => {
    const played = [
      ...ranked("FR", 60),
      ...rounds("AU", [4000, 4000, 3000, 9000, 4000, 300]),
      ...rounds("JP", [100]),
    ];
    render(<ContinentForm played={played} regions={REGIONS} />);

    const rows = screen.getAllByTestId("continent-form-row");
    expect(rows.map((r) => within(r).getByRole("heading").textContent)).toEqual([
      "Asia",
      "Europe" + "Your strong suit",
      "Oceania" + "Your weak spot",
    ]);
    expect(rows[2]).toHaveTextContent("4,000 km");
    expect(rows[2]).toHaveTextContent("6 rounds");
    expect(rows[2]).toHaveTextContent("1 within 500 km");
    // Asia has one round, so it waits to be ranked, and can still be played.
    expect(rows[0]).toHaveTextContent("4 more pinned rounds to rank");
    expect(within(rows[0]).getByRole("link", { name: "Play Asia" })).toHaveAttribute(
      "href",
      "/?region=asia",
    );

    const weak = screen.getByTestId("weak-spot");
    expect(weak).toHaveTextContent(
      "Your pins land furthest off in Oceania, about 4,000 km away, and nearest in Europe.",
    );
    expect(within(weak).getByRole("link", { name: "Practise Oceania" })).toHaveAttribute(
      "href",
      "/?region=oceania",
    );
  });

  it("offers no practice game on a continent the deck can't deal", () => {
    render(
      <ContinentForm
        played={[...ranked("FR", 60), ...ranked("BR", 6000)]}
        regions={{ Europe: ["a"] }}
      />,
    );
    expect(screen.getByTestId("weak-spot")).toHaveTextContent("furthest off in South America");
    expect(screen.queryByRole("link", { name: /Practise/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Play South America" })).toBeNull();
  });

  it("names no weak spot with only one ranked continent", () => {
    render(
      <ContinentForm played={[...ranked("FR", 60), ...rounds("AU", [9000])]} regions={REGIONS} />,
    );
    expect(screen.queryByTestId("weak-spot")).toBeNull();
    expect(screen.queryByText(/weak spot|strong suit/)).toBeNull();
  });

  it("says whether your last five rounds on a continent are closer, in your units", () => {
    window.localStorage.setItem(UNITS_KEY, "mi");
    render(
      <ContinentForm
        played={rounds("FR", [...Array(5).fill(1609.344), ...Array(5).fill(160.9344)])}
        regions={REGIONS}
      />,
    );
    expect(screen.getByTestId("continent-trend")).toHaveTextContent(
      "Getting closer: last 5 100 mi, 5 before 1,000 mi",
    );
    expect(screen.getByTestId("continent-form-row")).toHaveTextContent("5 within 311 mi");
  });
});
