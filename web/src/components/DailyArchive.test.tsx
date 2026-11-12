import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DailyArchive, { compactPoints } from "./DailyArchive";

describe("compactPoints", () => {
  it("shortens a game's score without ever rounding it up", () => {
    expect(compactPoints(0)).toBe("0");
    expect(compactPoints(940)).toBe("940");
    expect(compactPoints(18_240)).toBe("18.2k");
    expect(compactPoints(24_999)).toBe("24.9k");
    expect(compactPoints(25_000)).toBe("25k");
  });
});

describe("DailyArchive", () => {
  it("lays out 30 days oldest first, ending on today, naming each month where it starts", () => {
    render(<DailyArchive today="2026-10-29" scores={{}} onPlay={() => {}} />);
    const cells = within(screen.getByRole("list")).getAllByRole("button");
    expect(cells).toHaveLength(30);
    expect(cells[0]).toHaveAccessibleName("Sep 30: play it, not played yet");
    expect(cells[0]).toHaveTextContent("Sep 30");
    expect(cells[1]).toHaveTextContent("Oct 1");
    expect(cells[2]).toHaveTextContent(/^2 Play$/);
    expect(cells[29]).toHaveAccessibleName("Today: play it, not played yet");
    expect(screen.getByText(/Play any of the last 30 days\./)).toBeInTheDocument();
  });

  it("shows each kept score and plays the day tapped", () => {
    const onPlay = vi.fn();
    render(
      <DailyArchive
        today="2026-10-29"
        scores={{ "2026-10-20": 18_240, "2026-10-29": 9_000 }}
        playedDay="2026-10-20"
        onPlay={onPlay}
      />,
    );
    const day = screen.getByRole("button", { name: "October 20: 18.2k points (18,240). Play it again" });
    expect(day).toHaveTextContent("18.2k");
    expect(day).toHaveAttribute("aria-current", "date");
    expect(screen.getByText(/You've played 2 of the last 30 days\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "October 3: play it, not played yet" }));
    expect(onPlay).toHaveBeenCalledWith("2026-10-03");
  });
});
