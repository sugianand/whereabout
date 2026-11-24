import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { TrustResult } from "@/lib/game/trustAtlas";
import { recordTrustRead } from "@/lib/game/trustRead";

import TrustRead from "./TrustRead";

beforeEach(() => window.localStorage.clear());

const call = (call: "trust" | "doubt", atlasRight: boolean, p: number) =>
  recordTrustRead({ call, atlasRight } as TrustResult, p);

describe("TrustRead", () => {
  it("shows nothing until a call has been made", () => {
    const { container } = render(<TrustRead />);
    expect(container).toBeEmptyDOMElement();
  });

  it("charts your calls right at each sureness beside Atlas's own rule", async () => {
    call("doubt", false, 0.1);
    call("trust", true, 0.3);
    call("doubt", false, 0.4);
    call("doubt", true, 0.8);
    render(<TrustRead />);
    expect(await screen.findByTestId("trust-read-line")).toHaveTextContent(
      "You called 3 of 4 photos right (75%); Atlas's own rule called 3 (75%).You and Atlas's own sureness have called exactly as many right.",
    );
    const chart = screen.getByRole("list", { name: "Calls right by how sure Atlas was" });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(3);
    const mid = screen.getByTestId("trust-read-middling");
    expect(mid).toHaveTextContent(
      "Atlas was right on 1 of 2. Trusted 1 of 1 right answer · doubted 1 of 1 wrong one.",
    );
    expect(
      within(mid).getByRole("meter", { name: "You: calls right when Atlas was 25% to 50% sure" }),
    ).toHaveAttribute("aria-valuetext", "2 of 2 right · 100%");
    expect(screen.getByTestId("trust-read-middling-atlas")).toHaveTextContent("1 of 2 right · 50%");
    expect(screen.getByTestId("trust-read-high-you")).toHaveTextContent("0 of 1 right · 0%");
    expect(screen.getByTestId("trust-read-high-atlas")).toHaveTextContent("1 of 1 right · 100%");
    expect(screen.getByRole("link", { name: "Play Trust Atlas?" })).toHaveAttribute(
      "href",
      "/trust-atlas",
    );
  });
});
