/**
 * Head to head: every friend's challenge answered in this browser, kept so the player can look
 * back on who took each and send a rematch. Like the record and the map it lives only in this
 * browser, is best effort (blocked or full storage never stops a game) and whatever comes back
 * from storage goes through `parseChallengeLog`, which drops any malformed entry on its own.
 *
 * An entry is written as a challenge ends, from the same `HeadToHead` the picture is drawn from,
 * so the log and the picture always agree. The link answered is the entry's key: answering the
 * same link again replaces its entry with the newer result rather than counting it twice.
 */
import type { HeadToHead } from "./headToHead";

export const CHALLENGE_LOG_KEY = "whereabout:head-to-head";

/** How many answered challenges are kept; the newest stay when it overflows. */
export const MAX_CHALLENGES = 60;

/** Longest stored string, so a hand-edited entry can't fill the page. */
const MAX_TEXT = 4000;

export type ChallengeOutcome = HeadToHead["outcome"];

const OUTCOMES: readonly ChallengeOutcome[] = ["won", "lost", "tied"];

export interface AnsweredChallenge {
  /** The game, as the picture names it: "Blitz", "Hot and cold". */
  game: string;
  outcome: ChallengeOutcome;
  /** Both results over the whole game, in the game's own unit: "12,400 pts", "7 in a row". */
  you: string;
  friend: string;
  /** The friend's link that was answered, as a path and query on this site: plays it again. */
  link: string;
  /** The reply message with the player's own link, to send as a rematch. */
  reply: string;
  /** The local day it was answered, "2026-11-12". */
  day: string;
}

/** "2026-11-12" in the player's own time zone. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The answered link as a path and query on this site ("/whereabout/odd-one-out?challenge=…"),
 * or null when `href` isn't a challenge link. Only a same-site path is ever kept, so the
 * "play it again" link can never lead off the site.
 */
export function challengeLink(href: string): string | null {
  try {
    const url = new URL(href);
    if (!url.searchParams.has("challenge")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** The entry for a challenge that just ended, or null when the page isn't a challenge link. */
export function answeredFrom(
  h: HeadToHead,
  href: string,
  reply: string,
  now: Date,
): AnsweredChallenge | null {
  const link = challengeLink(href);
  if (!link) return null;
  return {
    game: h.game,
    outcome: h.outcome,
    you: h.youTotal,
    friend: h.friendTotal,
    link,
    reply,
    day: localDay(now),
  };
}

/** The log with one more answered challenge, newest last. Pure: returns a new array. */
export function noteChallenge(
  log: readonly AnsweredChallenge[],
  entry: AnsweredChallenge,
  max = MAX_CHALLENGES,
): AnsweredChallenge[] {
  const next = [...log.filter((e) => e.link !== entry.link), entry];
  return next.slice(Math.max(0, next.length - max));
}

const isText = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT;

function parseEntry(value: unknown): AnsweredChallenge | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (
    !isText(e.game) ||
    !OUTCOMES.includes(e.outcome as ChallengeOutcome) ||
    !isText(e.you) ||
    !isText(e.friend) ||
    !isText(e.link) ||
    !isText(e.reply) ||
    typeof e.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.day)
  ) {
    return null;
  }
  // A kept link must stay on this site: a path with a challenge in its query, never a URL.
  if (!e.link.startsWith("/") || e.link.startsWith("//") || !e.link.includes("challenge=")) {
    return null;
  }
  return {
    game: e.game,
    outcome: e.outcome as ChallengeOutcome,
    you: e.you,
    friend: e.friend,
    link: e.link,
    reply: e.reply,
    day: e.day,
  };
}

/** What storage held, keeping the well-formed entries (the last one per link) and no more. */
export function parseChallengeLog(value: unknown): AnsweredChallenge[] {
  if (!Array.isArray(value)) return [];
  let log: AnsweredChallenge[] = [];
  for (const item of value) {
    const entry = parseEntry(item);
    if (entry) log = noteChallenge(log, entry);
  }
  return log;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The answered challenges kept in this browser, oldest first. */
export function loadChallengeLog(): AnsweredChallenge[] {
  try {
    const raw = storage()?.getItem(CHALLENGE_LOG_KEY);
    return raw ? parseChallengeLog(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Keep a challenge that just ended. Best effort: storage that refuses it changes nothing. */
export function keepChallenge(entry: AnsweredChallenge): void {
  try {
    storage()?.setItem(CHALLENGE_LOG_KEY, JSON.stringify(noteChallenge(loadChallengeLog(), entry)));
  } catch {
    // Blocked or full storage: the game goes on without it.
  }
}

export interface Tally {
  won: number;
  lost: number;
  tied: number;
}

/** Won, lost and tied over some answered challenges. */
export function tally(log: readonly AnsweredChallenge[]): Tally {
  const t: Tally = { won: 0, lost: 0, tied: 0 };
  for (const e of log) t[e.outcome] += 1;
  return t;
}

export interface GameLog {
  game: string;
  tally: Tally;
  /** Newest first. */
  entries: AnsweredChallenge[];
}

/** The log by game, the game answered most recently first, each game's newest entry first. */
export function byGame(log: readonly AnsweredChallenge[]): GameLog[] {
  const games = new Map<string, AnsweredChallenge[]>();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const e = log[i];
    const list = games.get(e.game);
    if (list) list.push(e);
    else games.set(e.game, [e]);
  }
  return [...games].map(([game, entries]) => ({ game, tally: tally(entries), entries }));
}

/** "3 won, 1 lost, 2 tied", leaving out what's zero ("1 won"); "None yet" for nothing. */
export function tallyLine(t: Tally): string {
  const parts = [
    t.won && `${t.won} won`,
    t.lost && `${t.lost} lost`,
    t.tied && `${t.tied} tied`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "None yet";
}
