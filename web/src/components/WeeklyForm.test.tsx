import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlayedPhoto } from "@/lib/playedMap";
import { UNITS_KEY } from "@/lib/units";

import WeeklyForm from "./WeeklyForm";

let n = 0;
const round = (day: string, km: number | null, place = `Place ${n + 1}`): PlayedPhoto => {
  n += 1;
  return { id: `p${n}`, lng: 0, lat: 0, place, country: "FR", km, score: 2500, day };
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(UNITS_KEY, "km");
});

describe("WeeklyForm", () => {
  it("shows nothing until two weeks have pinned rounds", () => {
    const { container } = render(
      <WeeklyForm played={[round("2026-11-02", 400), round("2026-11-03", 800)]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("charts each week, says how the newest compares, and lists its rounds", () => {
    const played = [
      round("2026-10-19", 2000, "Lisbon"),
      round("2026-11-09", 300, "Kyoto"),
      round("2026-11-10", null, "Quito"),
      round("2026-11-11", 500, "Hobart"),
    ];
    render(<WeeklyForm played={played} />);

    expect(screen.getByTestId("weekly-trend")).toHaveTextContent(
      "Getting closer: 400 km the week of Nov 9, from 2,000 km the week of Oct 19.",
    );
    const bars = screen.getAllByTestId("week-bar");
    expect(bars).toHaveLength(2);
    expect(screen.getAllByTestId("week-empty")).toHaveLength(2);
    expect(bars[1]).toHaveAttribute("aria-pressed", "true");
    expect(bars[1]).toHaveAccessibleName("Week of Nov 9: 400 km off over 2 pinned rounds");

    // The newest week is open, its rounds newest first.
    const detail = screen.getByTestId("week-detail");
    expect(within(detail).getByRole("heading")).toHaveTextContent("Week of Nov 9");
    expect(
      within(detail)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Hobart500 km · 2,500 pts", "QuitoNo pin · 2,500 pts", "Kyoto300 km · 2,500 pts"]);

    fireEvent.click(bars[0]);
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");
    expect(bars[1]).toHaveAttribute("aria-pressed", "false");
    expect(within(detail).getByRole("heading")).toHaveTextContent(
      "Week of Oct 19: 2,000 km off over 1 pinned round",
    );
    expect(within(detail).getAllByRole("listitem")).toHaveLength(1);
  });

  it("reads in miles and lists a long week in part until asked", () => {
    window.localStorage.setItem(UNITS_KEY, "mi");
    const played = [
      round("2026-11-02", 1609.344),
      ...Array.from({ length: 11 }, () => round("2026-11-09", 3218.688)),
    ];
    render(<WeeklyForm played={played} />);
    expect(screen.getByTestId("weekly-trend")).toHaveTextContent(
      "Drifting further: 2,000 mi the week of Nov 9, from 1,000 mi the week of Nov 2.",
    );
    const detail = screen.getByTestId("week-detail");
    expect(within(detail).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Show all 11" }));
    expect(within(detail).getAllByRole("listitem")).toHaveLength(11);
  });
});
