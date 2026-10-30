import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatDistance } from "@/lib/geo";
import { UNITS_KEY } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import UnitsSwitch from "./UnitsSwitch";

/** Any distance on the page, reading the shared units the way the reveal and summary do. */
function Distance({ km }: { km: number }) {
  return <span data-testid="distance">{formatDistance(km, useUnits())}</span>;
}

afterEach(() => localStorage.clear());

describe("UnitsSwitch", () => {
  it("switches every distance on the page at once and keeps the choice", () => {
    localStorage.setItem(UNITS_KEY, "km");
    render(
      <>
        <UnitsSwitch />
        <Distance km={1000} />
        <Distance km={5} />
      </>,
    );
    const km = screen.getByRole("button", { name: "kilometres" });
    const mi = screen.getByRole("button", { name: "miles" });
    expect(km).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("distance").map((d) => d.textContent)).toEqual([
      "1,000 km",
      "5.0 km",
    ]);

    fireEvent.click(mi);
    expect(mi).toHaveAttribute("aria-pressed", "true");
    expect(km).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("distance").map((d) => d.textContent)).toEqual([
      "621 mi",
      "3.1 mi",
    ]);
    expect(localStorage.getItem(UNITS_KEY)).toBe("mi");
  });

  it("follows a choice made in another tab", () => {
    localStorage.setItem(UNITS_KEY, "km");
    render(<Distance km={100} />);
    expect(screen.getByTestId("distance")).toHaveTextContent("100 km");
    act(() => {
      localStorage.setItem(UNITS_KEY, "mi");
      window.dispatchEvent(new StorageEvent("storage", { key: UNITS_KEY }));
    });
    expect(screen.getByTestId("distance")).toHaveTextContent("62 mi");
  });
});
