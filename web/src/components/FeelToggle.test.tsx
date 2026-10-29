import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FEEL_KEY } from "@/lib/feel";

import FeelToggle from "./FeelToggle";

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("FeelToggle", () => {
  it("starts on, mutes on a tap, and keeps the choice for the next visit", async () => {
    setReducedMotion(false);
    const { unmount } = render(<FeelToggle />);
    const toggle = await screen.findByRole("button", { name: "Sound and vibration at the reveal" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem(FEEL_KEY)).toBe("off");

    unmount();
    render(<FeelToggle />);
    expect(
      await screen.findByRole("button", { name: "Sound and vibration at the reveal" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("is not offered under reduced motion, where the reveal stays silent and still", () => {
    setReducedMotion(true);
    render(<FeelToggle />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
