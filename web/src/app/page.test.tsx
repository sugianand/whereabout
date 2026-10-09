import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("names the product and explains it in one sentence", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Whereabout" })).toBeInTheDocument();
    expect(screen.getByText(/beat Atlas/)).toBeInTheDocument();
  });
});
