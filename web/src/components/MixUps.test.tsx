import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BEST_MIX_UPS_KEY } from "@/lib/game/nameMixUps";
import { MIX_UPS_KEY, TOP_PAIRS, keepMixUp } from "@/lib/mixUps";

import MixUps from "./MixUps";

beforeEach(() => {
  window.localStorage.clear();
});

describe("MixUps", () => {
  it("shows nothing until a wrong country has been tapped", () => {
    const { container } = render(<MixUps streakable={["Asia"]} photoCounts={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the pairs mixed up most, how often and which way round, with a streak to practise", async () => {
    keepMixUp("JP", "KR");
    keepMixUp("KR", "JP");
    keepMixUp("JP", "KR");
    keepMixUp("NZ", "AU");
    render(<MixUps streakable={["Asia", "Europe"]} photoCounts={{}} />);

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
    const { unmount } = render(<MixUps streakable={[]} photoCounts={{}} />);
    expect(await screen.findAllByTestId("mix-up")).toHaveLength(TOP_PAIRS);
    unmount();

    window.localStorage.setItem(MIX_UPS_KEY, '[{"truth":"JP"},"x"]');
    const { container } = render(<MixUps streakable={[]} photoCounts={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a Name the country run of the mix-ups once it can deal enough photos, with its best", async () => {
    keepMixUp("JP", "KR");
    const { unmount } = render(
      <MixUps streakable={["Asia"]} photoCounts={{ JP: 1, KR: 1, FR: 9 }} />,
    );
    await screen.findAllByTestId("mix-up");
    // Two photos between Japan and South Korea: too few for a run, so none is offered.
    expect(screen.queryByRole("link", { name: "Practise your mix-ups" })).toBeNull();
    unmount();

    window.localStorage.setItem(BEST_MIX_UPS_KEY, "4");
    render(<MixUps streakable={["Asia"]} photoCounts={{ JP: 2, KR: 1, FR: 9 }} />);
    expect(await screen.findByRole("link", { name: "Practise your mix-ups" })).toHaveAttribute(
      "href",
      "/name-country/mix-ups",
    );
    expect(screen.getByTestId("mix-ups-practice-note")).toHaveTextContent(
      "Name the country with 3 photos from these countries, the one you took each for among the four. Your best: 4 in a row.",
    );
  });
});
