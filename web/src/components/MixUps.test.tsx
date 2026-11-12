import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MIX_UPS_KEY, TOP_PAIRS, keepMixUp } from "@/lib/mixUps";

import MixUps from "./MixUps";

beforeEach(() => {
  window.localStorage.clear();
});

describe("MixUps", () => {
  it("shows nothing until a wrong country has been tapped", () => {
    const { container } = render(<MixUps streakable={["Asia"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the pairs mixed up most, how often and which way round, with a streak to practise", async () => {
    keepMixUp("JP", "KR");
    keepMixUp("KR", "JP");
    keepMixUp("JP", "KR");
    keepMixUp("NZ", "AU");
    render(<MixUps streakable={["Asia", "Europe"]} />);

    const rows = await screen.findAllByTestId("mix-up");
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(within(first).getByRole("heading")).toHaveTextContent("Japan and South Korea");
    expect(within(first).getByTestId("mix-up-times")).toHaveTextContent("3 times");
    expect(first).toHaveTextContent(
      "You said South Korea for Japan twice, and Japan for South Korea once.",
    );
    expect(within(first).getByRole("link", { name: "Country Streak in Asia" })).toHaveAttribute(
      "href",
      "/streak?region=asia",
    );
    expect(screen.getByText(/from your last 4 wrong answers/)).toBeInTheDocument();

    // Oceania can't deal a streak here, so the pair has no practice link.
    expect(within(second).getByRole("heading")).toHaveTextContent("New Zealand and Australia");
    expect(within(second).getByTestId("mix-up-times")).toHaveTextContent("once");
    expect(within(second).queryByRole("link")).toBeNull();
  });

  it("lists only the top pairs, and reads junk storage as nothing kept", async () => {
    for (const [a, b] of [
      ["NO", "SE"],
      ["PT", "ES"],
      ["AR", "CL"],
      ["FI", "EE"],
      ["AT", "DE"],
      ["IE", "GB"],
    ]) {
      keepMixUp(a, b);
    }
    const { unmount } = render(<MixUps streakable={[]} />);
    expect(await screen.findAllByTestId("mix-up")).toHaveLength(TOP_PAIRS);
    unmount();

    window.localStorage.setItem(MIX_UPS_KEY, '[{"truth":"JP"},"x"]');
    const { container } = render(<MixUps streakable={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
