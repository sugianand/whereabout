import { beforeEach, describe, expect, it } from "vitest";

import {
  CHALLENGE_LOG_KEY,
  answeredFrom,
  byGame,
  challengeLink,
  keepChallenge,
  loadChallengeLog,
  localDay,
  noteChallenge,
  parseChallengeLog,
  tally,
  tallyLine,
  type AnsweredChallenge,
} from "./challengeLog";
import type { HeadToHead } from "./headToHead";

const entry = (over: Partial<AnsweredChallenge> = {}): AnsweredChallenge => ({
  game: "Odd one out",
  outcome: "won",
  you: "3 in a row",
  friend: "1 in a row",
  link: "/whereabout/odd-one-out?challenge=a.b.c.d_1_2",
  reply: "Whereabout · Odd one out: …\nhttps://example.org/whereabout/odd-one-out?challenge=x_3_1",
  day: "2026-11-12",
  ...over,
});

const h2h: HeadToHead = {
  game: "Blitz",
  youTotal: "12,400 pts",
  friendTotal: "9,000 pts",
  outcome: "won",
  rows: [],
  url: "https://example.org/whereabout/",
};

beforeEach(() => localStorage.clear());

describe("challengeLink", () => {
  it("keeps only the path and query of a challenge link", () => {
    expect(challengeLink("https://example.org/whereabout/streak?region=asia&challenge=a_1")).toBe(
      "/whereabout/streak?region=asia&challenge=a_1",
    );
  });

  it("is null for a page that isn't a challenge, or junk", () => {
    expect(challengeLink("https://example.org/whereabout/streak")).toBeNull();
    expect(challengeLink("not a url")).toBeNull();
  });
});

describe("answeredFrom", () => {
  it("words the entry from the head to head, on the local day", () => {
    const at = new Date(2026, 0, 5, 23, 30);
    expect(
      answeredFrom(h2h, "https://example.org/whereabout/?challenge=a_1_t2", "reply", at),
    ).toEqual({
      game: "Blitz",
      outcome: "won",
      you: "12,400 pts",
      friend: "9,000 pts",
      link: "/whereabout/?challenge=a_1_t2",
      reply: "reply",
      day: "2026-01-05",
    });
    expect(localDay(at)).toBe("2026-01-05");
  });

  it("keeps nothing when the address has lost its challenge", () => {
    expect(answeredFrom(h2h, "https://example.org/whereabout/", "reply", new Date())).toBeNull();
  });
});

describe("noteChallenge", () => {
  it("adds newest last, and replaces the entry for a link answered again", () => {
    const first = entry();
    const other = entry({ link: "/whereabout/odd-one-out?challenge=e.f.g.h_0_1" });
    const again = entry({ outcome: "lost", you: "0 in a row" });
    const log = noteChallenge(noteChallenge(noteChallenge([], first), other), again);
    expect(log).toEqual([other, again]);
  });

  it("keeps the newest when the log overflows", () => {
    let log: AnsweredChallenge[] = [];
    for (let i = 0; i < 5; i += 1) log = noteChallenge(log, entry({ link: `/?challenge=${i}` }), 3);
    expect(log.map((e) => e.link)).toEqual(["/?challenge=2", "/?challenge=3", "/?challenge=4"]);
  });
});

describe("parseChallengeLog", () => {
  it("keeps well-formed entries and drops the rest", () => {
    const good = entry();
    expect(
      parseChallengeLog([
        good,
        { ...good, outcome: "draw" },
        { ...good, day: "yesterday" },
        { ...good, you: "" },
        { ...good, link: "https://evil.example/?challenge=a" },
        { ...good, link: "//evil.example/?challenge=a" },
        { ...good, link: "/whereabout/odd-one-out" },
        { ...good, reply: "x".repeat(5000) },
        null,
        "junk",
      ]),
    ).toEqual([good]);
    expect(parseChallengeLog({ not: "a list" })).toEqual([]);
  });
});

describe("storage", () => {
  it("keeps and reads back answered challenges", () => {
    keepChallenge(entry());
    keepChallenge(entry({ link: "/?challenge=b", game: "Blitz", outcome: "tied" }));
    expect(loadChallengeLog().map((e) => e.game)).toEqual(["Odd one out", "Blitz"]);
  });

  it("reads unreadable storage as nothing kept", () => {
    localStorage.setItem(CHALLENGE_LOG_KEY, "{not json");
    expect(loadChallengeLog()).toEqual([]);
    keepChallenge(entry());
    expect(loadChallengeLog()).toEqual([entry()]);
  });
});

describe("tallies", () => {
  const log = [
    entry({ link: "/?challenge=1" }),
    entry({ link: "/?challenge=2", game: "Blitz", outcome: "lost" }),
    entry({ link: "/?challenge=3", outcome: "tied" }),
    entry({ link: "/?challenge=4", outcome: "won" }),
  ];

  it("counts won, lost and tied, and words them", () => {
    expect(tally(log)).toEqual({ won: 2, lost: 1, tied: 1 });
    expect(tallyLine(tally(log))).toBe("2 won, 1 lost, 1 tied");
    expect(tallyLine({ won: 0, lost: 3, tied: 0 })).toBe("3 lost");
    expect(tallyLine({ won: 0, lost: 0, tied: 0 })).toBe("None yet");
  });

  it("groups by game, the latest game and entry first", () => {
    const games = byGame(log);
    expect(games.map((g) => g.game)).toEqual(["Odd one out", "Blitz"]);
    expect(games[0].entries.map((e) => e.link)).toEqual([
      "/?challenge=4",
      "/?challenge=3",
      "/?challenge=1",
    ]);
    expect(games[0].tally).toEqual({ won: 2, lost: 0, tied: 1 });
  });
});
