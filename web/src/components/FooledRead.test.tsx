import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { judgeFooled, type Side } from "@/lib/game/fooledAtlas";
import { recordFooledRead } from "@/lib/game/fooledRead";

import FooledRead from "./FooledRead";

beforeEach(() => window.localStorage.clear());

/** You pick `you` and Atlas picks `atlas` on misses of `a` and `b` km. */
const pick = (you: Side, atlas: Side, a: number, b: number) =>
  recordFooledRead(judgeFooled(you, a, b), judgeFooled(atlas, a, b), a, b);

describe("FooledRead", () => {
  it("shows nothing until a pair has been picked", () => {
    const { container } = render(<FooledRead />);
    expect(container).toBeEmptyDOMElement();
  });

  it("charts your pairs right by how far apart the misses were, beside Atlas's sureness", async () => {
    pick("a", "b", 500, 200); // close: you right, Atlas wrong
    pick("b", "b", 100, 500); // clear: both right
    pick("a", "a", 100, 2_000); // far apart: both wrong
    pick("b", "a", 100, 3_000); // far apart: you right
    pick("a", "b", 10, 20); // a dead heat
    render(<FooledRead />);
    expect(await screen.findByTestId("fooled-read-line")).toHaveTextContent(
      "You picked 3 of 4 pairs right (75%); Atlas's own sureness picked 1 (25%).You read Atlas's misses better than its own sureness does.",
    );
    expect(screen.getByTestId("fooled-read-ties")).toHaveTextContent(
      "1 dead heat isn't counted: any pick is right on those.",
    );
    const chart = screen.getByRole("list", {
      name: "Pairs right by how far apart Atlas's misses were",
    });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(3);
    const far = screen.getByTestId("fooled-read-far");
    expect(far).toHaveTextContent("2 pairs picked.");
    expect(
      within(far).getByRole("meter", { name: "You: pairs right with 10 times the other or more" }),
    ).toHaveAttribute("aria-valuetext", "1 of 2 right · 50%");
    expect(screen.getByTestId("fooled-read-far-atlas")).toHaveTextContent("0 of 2 right · 0%");
    expect(screen.getByTestId("fooled-read-close-you")).toHaveTextContent("1 of 1 right · 100%");
    expect(screen.getByTestId("fooled-read-clear-atlas")).toHaveTextContent("1 of 1 right · 100%");
    expect(screen.getByRole("link", { name: "Play Which fooled Atlas?" })).toHaveAttribute(
      "href",
      "/fooled-atlas",
    );
  });

  it("says no pair counts yet when every pick was a dead heat", async () => {
    pick("a", "b", 10, 20);
    render(<FooledRead />);
    expect(await screen.findByTestId("fooled-read-line")).toHaveTextContent("No pairs read yet.");
    expect(screen.getByTestId("fooled-read-close")).toHaveTextContent(
      "No pairs this far apart yet.",
    );
  });
});
