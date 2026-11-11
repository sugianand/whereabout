/**
 * The head-to-head picture: the end of a friend's challenge as an image of both results, photo by
 * photo, with who took each one and who took the game. It is sent with the reply link beside it,
 * so the picture shows how it went and the link lets the friend answer.
 *
 * Like the share card (src/lib/shareImage.ts) it is drawn only from numbers and fixed words: a
 * row's label ("Photo 3") and the two results on it, never a photo, a place, a country, a photo
 * id or a coordinate. The address drawn at its foot is the game page without its query, so the
 * challenge link's photo ids stay in the text that goes with it. headToHead.test.ts holds every
 * word drawn to that against the whole catalog.
 *
 * Every challenge game words its own results (points, a streak, places right), so a game builds a
 * `HeadToHead` from its own end screen and this module only lays it out and paints it, through
 * the share card's `drawShareImage`.
 */
import { challengeOutcome, sumScores, type Challenge } from "@/lib/game/challenge";
import type { RoundResult } from "@/lib/game/state";
import { formatPoints } from "@/lib/geo";

import {
  IMAGE_SIZE,
  INK,
  SANS,
  SIGN,
  drawShareImage,
  sendShareImage,
  type ImageOutcome,
  type ImageRect,
  type ImageText,
  type ShareImageLayout,
} from "./shareImage";

/** Who took a row: the player, the friend who sent the challenge, neither, or no call at all. */
export type RowWinner = "you" | "friend" | "tie" | "none";

export interface HeadToHeadRow {
  /** "Photo 1": which part of the game, never what was in it. */
  label: string;
  you: string;
  friend: string;
  winner: RowWinner;
}

export interface HeadToHead {
  /** The game, e.g. "Blitz" or "Hot and cold". */
  game: string;
  /** The player's and the friend's results over the whole game, worded in the game's unit. */
  youTotal: string;
  friendTotal: string;
  outcome: "won" | "lost" | "tied";
  rows: HeadToHeadRow[];
  /** The game page; only its origin and path are drawn. */
  url: string;
}

/** The most rows the picture lists; a longer game shows its first rows and a count of the rest. */
export const MAX_ROWS = 12;

const WINNER_INK: Record<RowWinner, string> = {
  you: INK.sonar,
  friend: INK.flare,
  tie: INK.gold,
  none: INK.dim,
};

export const OUTCOME_HEADLINE: Record<HeadToHead["outcome"], { text: string; color: string }> = {
  won: { text: "You won", color: INK.sonar },
  lost: { text: "Your friend won", color: INK.flare },
  tied: { text: "A dead heat", color: INK.gold },
};

/** "example.org/whereabout/": the page to play on, without any query that names photos. */
export function siteAddress(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/** The rows the picture can fit: all of them, or the first ones and "+7 more". */
export function shownRows(rows: readonly HeadToHeadRow[]): HeadToHeadRow[] {
  if (rows.length <= MAX_ROWS) return [...rows];
  const kept = rows.slice(0, MAX_ROWS - 1);
  const more = rows.length - kept.length;
  return [...kept, { label: `+${more} more`, you: "", friend: "", winner: "none" }];
}

const MARGIN = 96;
/** Centres of the two result columns. */
const YOU_X = 560;
const FRIEND_X = 840;
const COLUMN_W = 264;
const TABLE_TOP = 520;
const TABLE_BOTTOM = 950;

/** Every shape and word of the head-to-head picture, in paint order. */
export function headToHeadLayout(h: HeadToHead): ShareImageLayout {
  const W = IMAGE_SIZE;
  const rects: ImageRect[] = [
    { x: 32, y: 32, w: W - 64, h: W - 64, radius: 40, stroke: INK.frame },
  ];
  const texts: ImageText[] = [];
  const text = (
    t: string,
    x: number,
    y: number,
    font: string,
    color: string,
    align: ImageText["align"] = "left",
  ) => texts.push({ text: t, x, y, font, color, align });

  text("WHEREABOUT", MARGIN, 160, `800 64px ${SIGN}`, INK.chalk);
  text(`${h.game}: head to head`, MARGIN, 222, `400 40px ${SANS}`, INK.dim);
  const headline = OUTCOME_HEADLINE[h.outcome];
  text(headline.text, MARGIN, 350, `800 120px ${SIGN}`, headline.color);

  // The two totals as the table's heading, so each column says whose it is.
  text("You", YOU_X, 432, `700 36px ${SANS}`, INK.sonar, "center");
  text("Friend", FRIEND_X, 432, `700 36px ${SANS}`, INK.flare, "center");
  text(h.youTotal, YOU_X, 484, `800 44px ${SIGN}`, INK.chalk, "center");
  text(h.friendTotal, FRIEND_X, 484, `800 44px ${SIGN}`, INK.chalk, "center");

  const rows = shownRows(h.rows);
  const rowH = Math.min(80, (TABLE_BOTTOM - TABLE_TOP) / Math.max(rows.length, 1));
  const size = Math.round(Math.min(38, rowH * 0.5));
  // Results shrink together until the longest fits its column: a bold digit is about 0.56 em.
  const longest = Math.max(1, ...rows.flatMap((r) => [r.you.length, r.friend.length]));
  const cell = Math.round(Math.min(size, (COLUMN_W - 32) / (longest * 0.56)));
  rows.forEach((r, i) => {
    const top = TABLE_TOP + i * rowH;
    const baseline = top + rowH / 2 + size * 0.36;
    const cellBaseline = top + rowH / 2 + cell * 0.36;
    if (i > 0)
      rects.push({ x: MARGIN, y: top, w: W - 2 * MARGIN, h: 2, radius: 1, fill: INK.frame });
    text(r.label, MARGIN, baseline, `400 ${size}px ${SANS}`, INK.dim);
    // The row's winner sits on a tinted pill in their colour; a tie tints both.
    const pill = (x: number) =>
      rects.push({
        x: x - COLUMN_W / 2,
        y: top + rowH * 0.14,
        w: COLUMN_W,
        h: rowH * 0.72,
        radius: Math.min(20, rowH * 0.3),
        stroke: WINNER_INK[r.winner],
      });
    if (r.winner === "you" || r.winner === "tie") pill(YOU_X);
    if (r.winner === "friend" || r.winner === "tie") pill(FRIEND_X);
    const youInk = r.winner === "you" || r.winner === "tie" ? WINNER_INK[r.winner] : INK.chalk;
    const friendInk =
      r.winner === "friend" || r.winner === "tie" ? WINNER_INK[r.winner] : INK.chalk;
    text(r.you, YOU_X, cellBaseline, `700 ${cell}px ${SANS}`, youInk, "center");
    text(r.friend, FRIEND_X, cellBaseline, `700 ${cell}px ${SANS}`, friendInk, "center");
  });

  text(siteAddress(h.url), MARGIN, 1020, `400 28px ${SANS}`, INK.dim);
  return { width: W, height: W, background: INK.background, rects, texts };
}

/** Draw the head-to-head into a PNG, as `renderShareImage` does for the share card. */
export async function renderHeadToHead(
  h: HeadToHead,
  doc: Document = document,
): Promise<Blob | null> {
  const layout = headToHeadLayout(h);
  try {
    await Promise.all([...new Set(layout.texts.map((t) => t.font))].map((f) => doc.fonts?.load(f)));
  } catch {
    // A font that won't load draws in its fallback; the picture still says the same thing.
  }
  const canvas = doc.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawShareImage(ctx, layout);
  return new Promise((done) => canvas.toBlob((blob) => done(blob), "image/png"));
}

/** What the note under the button says as the picture is drawn and sent. */
export const HEAD_TO_HEAD_NOTE: Record<ImageOutcome | "drawing", string> = {
  drawing: "Drawing your head to head…",
  shared: "Head to head shared, with the link to answer it.",
  downloaded: "Head to head saved. Post it with the link, which is copied too.",
  cancelled: "",
  failed: "Couldn't draw the picture in this browser. Send your score back as text instead.",
};

/**
 * Draw the head-to-head and send it with `replyText`, the reply link's message. Where the picture
 * is saved rather than shared, the reply text is copied too, so the link isn't lost.
 */
export async function sendHeadToHead(
  h: HeadToHead,
  replyText: string,
  nav: Navigator = navigator,
): Promise<ImageOutcome> {
  try {
    const blob = await renderHeadToHead(h);
    if (!blob) return "failed";
    const outcome = await sendShareImage(blob, headToHeadName(h), replyText, nav);
    if (outcome === "downloaded") await nav.clipboard?.writeText(replyText).catch(() => {});
    return outcome;
  } catch {
    // No canvas to draw on: the note says so and the reply link still works.
    return "failed";
  }
}

/** "whereabout-blitz-head-to-head.png". */
export function headToHeadName(h: HeadToHead): string {
  const slug = `${h.game} head to head`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `whereabout-${slug}.png`;
}

/** Who took a row on a number where more is better: points, a streak, places right. */
export function rowWinner(you: number, friend: number): RowWinner {
  return you > friend ? "you" : you < friend ? "friend" : "tie";
}

/** "3,100" or, on a Blitz, "3,100 · 12s" ("time up" when the clock ran out). */
function pointsWithClock(points: number, seconds: number | undefined): string {
  if (seconds === undefined) return formatPoints(points);
  return `${formatPoints(points)} · ${seconds > 0 ? `${seconds}s` : "time up"}`;
}

/**
 * The head-to-head of a five-photo challenge (the classic game and Blitz): both scores on every
 * photo, and on a Blitz the seconds each had left. Points decide each photo and the game, as the
 * results screen does; the clock is shown, not scored.
 */
export function fivePhotoHeadToHead(
  game: string,
  results: readonly RoundResult[],
  friend: Challenge,
  url: string,
): HeadToHead {
  const you = sumScores(results.map((r) => r.reveal.score));
  const them = sumScores(friend.scores);
  const timed = friend.secondsLeft !== undefined;
  return {
    game,
    youTotal: `${formatPoints(you)} pts`,
    friendTotal: `${formatPoints(them)} pts`,
    outcome: challengeOutcome(you, them),
    rows: results.map((r, i) => {
      const theirs = friend.scores[i] ?? 0;
      return {
        label: `Photo ${i + 1}`,
        you: pointsWithClock(r.reveal.score, timed ? (r.secondsLeft ?? 0) : undefined),
        friend: pointsWithClock(theirs, timed ? (friend.secondsLeft?.[i] ?? 0) : undefined),
        winner: friend.scores[i] === undefined ? "none" : rowWinner(r.reveal.score, theirs),
      };
    }),
    url,
  };
}

/** The words the picture says, for a screen reader beside the button and for the tests. */
export function headToHeadSummary(h: HeadToHead): string {
  return `${OUTCOME_HEADLINE[h.outcome].text}: you ${h.youTotal}, your friend ${h.friendTotal}.`;
}

/** One side of a run game (Odd one out, Further North, Which way?): how far it went, how it ended. */
export interface RunSide {
  /** Calls right in a row. */
  streak: number;
  /**
   * True when the run ended on a wrong call the picture can show: the call after the streak.
   * False for a run that ran out of photos, or a friend's link that stops before its miss.
   */
  missed: boolean;
}

/** What a run game calls each part of it: "Quad" and "Quads". */
export interface RunUnit {
  one: string;
  many: string;
}

/** "Right", "Wrong", or a dash on a call that side never reached. */
function runCell(side: RunSide, i: number): string {
  if (i < side.streak) return "Right";
  return side.missed && i === side.streak ? "Wrong" : "—";
}

/**
 * Who took a call in a run: the side that got it right when the other got it wrong or never
 * reached it, both on a call each got wrong. A call both got right is no one's, so only the calls
 * where the runs split are ringed.
 */
function runWinner(you: string, friend: string): RowWinner {
  if (you === friend) return you === "Wrong" ? "tie" : "none";
  if (you === "Right") return "you";
  if (friend === "Right") return "friend";
  return "none";
}

/**
 * Fold a long run's stretches of the same two results into one row each, "Quads 1–14", so the
 * picture still reaches where each run ended. Runs that fit are left call by call.
 */
export function foldRunRows(rows: readonly HeadToHeadRow[], unit: RunUnit): HeadToHeadRow[] {
  if (rows.length <= MAX_ROWS) return [...rows];
  const out: HeadToHeadRow[] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const same =
      i < rows.length && rows[i].you === rows[start].you && rows[i].friend === rows[start].friend;
    if (same) continue;
    const label = i - start === 1 ? rows[start].label : `${unit.many} ${start + 1}–${i}`;
    out.push({ ...rows[start], label });
    start = i;
  }
  return out;
}

/**
 * The head-to-head of a run game: both runs call by call, as far as the longer one went, each
 * call right, wrong, or not reached, so the rows show where each run ended. The longer streak
 * takes the game, as the end screen says.
 */
export function runHeadToHead(
  game: string,
  unit: RunUnit,
  you: RunSide,
  friend: RunSide,
  url: string,
): HeadToHead {
  const reach = (s: RunSide) => s.streak + (s.missed ? 1 : 0);
  const n = Math.max(reach(you), reach(friend));
  const rows = Array.from({ length: n }, (_, i): HeadToHeadRow => {
    const mine = runCell(you, i);
    const theirs = runCell(friend, i);
    return {
      label: `${unit.one} ${i + 1}`,
      you: mine,
      friend: theirs,
      winner: runWinner(mine, theirs),
    };
  });
  return {
    game,
    youTotal: `${you.streak} in a row`,
    friendTotal: `${friend.streak} in a row`,
    outcome: challengeOutcome(you.streak, friend.streak),
    rows: foldRunRows(rows, unit),
    url,
  };
}
