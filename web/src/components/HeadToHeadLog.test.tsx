import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { keepChallenge, type AnsweredChallenge } from "@/lib/challengeLog";

import HeadToHeadLog, { dayLabel } from "./HeadToHeadLog";

const entry = (over: Partial<AnsweredChallenge>): AnsweredChallenge => ({
  game: "Odd one out",
  outcome: "won",
  you: "3 in a row",
  friend: "1 in a row",
  link: "/odd-one-out?challenge=a_1_2",
  reply:
    "Whereabout · Odd one out: I spotted the odd one in 3 quads in a row.\nhttp://x/?challenge=b",
  day: "2026-11-12",
  ...over,
});

function stubClipboard() {
  const box = { sent: "" };
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (t: string) => void (box.sent = t) },
    configurable: true,
  });
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  return box;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("HeadToHeadLog", () => {
  it("shows nothing until a friend's challenge has been answered", () => {
    const { container } = render(<HeadToHeadLog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every answered challenge by game, won, lost or tied, newest first", async () => {
    keepChallenge(entry({ link: "/odd-one-out?challenge=1" }));
    keepChallenge(
      entry({
        game: "Blitz",
        outcome: "lost",
        you: "9,000 pts",
        friend: "12,400 pts",
        link: "/?challenge=2",
        day: "2025-12-31",
      }),
    );
    keepChallenge(entry({ link: "/odd-one-out?challenge=3", outcome: "tied", you: "1 in a row" }));
    render(<HeadToHeadLog />);

    expect(await screen.findByTestId("head-to-head-total")).toHaveTextContent(
      "1 won, 1 lost, 1 tied",
    );
    const cards = screen
      .getAllByRole("listitem")
      .filter((li) => li.dataset.testid?.startsWith("head-to-head-"));
    expect(cards.map((c) => c.dataset.testid)).toEqual([
      "head-to-head-odd-one-out",
      "head-to-head-entry",
      "head-to-head-entry",
      "head-to-head-blitz",
      "head-to-head-entry",
    ]);

    const odd = screen.getByTestId("head-to-head-odd-one-out");
    expect(within(odd).getByTestId("head-to-head-odd-one-out-tally")).toHaveTextContent(
      "1 won, 1 tied",
    );
    const rows = within(odd).getAllByTestId("head-to-head-entry");
    expect(rows[0]).toHaveTextContent("TiedYou 1 in a row · Friend 1 in a row");
    expect(rows[1]).toHaveTextContent("WonYou 3 in a row · Friend 1 in a row");
    expect(within(rows[0]).getByRole("link", { name: "Play theirs again" })).toHaveAttribute(
      "href",
      "/odd-one-out?challenge=3",
    );

    const blitz = screen.getByTestId("head-to-head-blitz");
    expect(blitz).toHaveTextContent("LostYou 9,000 pts · Friend 12,400 pts");
    expect(blitz).toHaveTextContent("31 Dec 2025");
  });

  it("sends the player's own result back as a rematch", async () => {
    keepChallenge(entry({}));
    const box = stubClipboard();
    render(<HeadToHeadLog />);
    fireEvent.click(await screen.findByRole("button", { name: "Send a rematch" }));
    await waitFor(() =>
      expect(screen.getByText("Rematch link copied. Paste it to your friend.")).toBeInTheDocument(),
    );
    expect(box.sent).toBe(entry({}).reply);
  });

  it("words a day of this year without the year", () => {
    expect(dayLabel("2026-11-12", new Date(2026, 5, 1))).toBe("12 Nov");
    expect(dayLabel("2025-01-03", new Date(2026, 5, 1))).toBe("3 Jan 2025");
  });
});
