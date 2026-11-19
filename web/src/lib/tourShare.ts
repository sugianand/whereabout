/**
 * Share your World Tour: a picture of the route, each stop cleared, next or still ahead, with
 * every leg's best game against Atlas as a lead or a deficit, and a text line of the same counts.
 *
 * Like the album's picture (src/lib/albumShare.ts) it is drawn only from numbers and fixed words:
 * the continents of the route, how many are cleared, and each leg's best margin in points. The
 * tour record holds no photo at all, so the picture can't name one; tourShare.test.ts still holds
 * every word drawn to the route's names, numbers and the picture's own labels.
 */
import type { Continent } from "@/lib/continents";
import { formatPoints } from "@/lib/geo";
import { clearedCount, nextStop, type TourRecord } from "@/lib/tour";
import { stopState, type StopState } from "@/lib/tourMap";

import {
  IMAGE_SIZE,
  INK,
  SANS,
  SIGN,
  renderLayout,
  sendShareImage,
  type ImageMark,
  type ImageOutcome,
  type ImageRect,
  type ImageText,
  type ShareImageLayout,
} from "./shareImage";

export interface TourShareLeg {
  continent: Continent;
  state: StopState;
  /** The best game's points minus Atlas's (negative when Atlas still leads), null if not played. */
  lead: number | null;
}

export interface TourShareCard {
  cleared: number;
  total: number;
  /** Every leg of a non-empty route is cleared. */
  complete: boolean;
  legs: TourShareLeg[];
  /** The tour page, so a friend starts their own tour. */
  url: string;
}

/**
 * The tour page from the page being shared: "https://example.org/whereabout/tour/?x#y" and the
 * game's home page both give "https://example.org/whereabout/tour/".
 */
export function tourPage(href: string): string {
  const url = new URL(href);
  const path = url.pathname.replace(/tour\/?$/, "");
  return `${url.origin}${path.endsWith("/") ? path : `${path}/`}tour/`;
}

/** The route's legs, their states and best margins against Atlas, and nothing else. */
export function tourShareCard(
  route: readonly Continent[],
  record: TourRecord,
  href: string,
): TourShareCard {
  const next = nextStop(route, record);
  const cleared = clearedCount(route, record);
  return {
    cleared,
    total: route.length,
    complete: route.length > 0 && next === null,
    legs: route.map((continent) => {
      const best = record[continent]?.best;
      return {
        continent,
        state: stopState(continent, record, next),
        lead: best ? best.you - best.atlas : null,
      };
    }),
    url: tourPage(href),
  };
}

/** A leg played at least once: one worth sharing. */
export function tourHasPlay(card: Pick<TourShareCard, "legs">): boolean {
  return card.legs.some((l) => l.lead !== null);
}

/** "+1,204", "−312" (a true minus), "tied" or "not played". */
export function leadWords(lead: number | null): string {
  if (lead === null) return "not played";
  if (lead === 0) return "tied";
  return `${lead > 0 ? "+" : "−"}${formatPoints(Math.abs(lead))}`;
}

/** The first line of the text, and the picture's line under the count. */
function headline(card: TourShareCard): string {
  return card.complete
    ? `Whereabout World Tour: complete, Atlas beaten on all ${card.total} continents`
    : `Whereabout World Tour: ${card.cleared} of ${card.total} continents cleared against Atlas`;
}

/** The headline, each leg's best margin (✓ once cleared), then the tour page. */
export function tourShareText(card: TourShareCard): string {
  return [
    headline(card),
    card.legs
      .map((l) => `${l.continent} ${leadWords(l.lead)}${l.state === "cleared" ? " ✓" : ""}`)
      .join(" · "),
    card.url,
  ].join("\n");
}

/** The words for a screen reader beside the button, and for the tests. */
export function tourShareSummary(card: Pick<TourShareCard, "cleared" | "total">): string {
  return `Your World Tour: ${card.cleared} of ${card.total} continents cleared.`;
}

const MARGIN = 96;
const ROUTE_Y = 530;
const LEGS_HEADING = 640;
const LEGS_TOP = 656;
const LEGS_BOTTOM = 970;
const STATE_X = 560;

/** What each state of stop looks like on the route: size, ring, fill, so colour is never alone. */
const STOP_LOOK: Record<StopState, { r: number; ring: string; fill: string }> = {
  cleared: { r: 22, ring: INK.gold, fill: INK.gold },
  next: { r: 28, ring: INK.sonar, fill: INK.background },
  ahead: { r: 18, ring: INK.frame, fill: INK.background },
};

const STATE_WORD: Record<StopState, { text: string; color: string }> = {
  cleared: { text: "cleared", color: INK.gold },
  next: { text: "next stop", color: INK.sonar },
  ahead: { text: "", color: INK.dim },
};

function leadColor(lead: number | null): string {
  if (lead === null) return INK.dim;
  if (lead === 0) return INK.gold;
  return lead > 0 ? INK.sonar : INK.flare;
}

/** Every shape and word of the tour picture, in paint order. */
export function tourShareLayout(card: TourShareCard): ShareImageLayout {
  const W = IMAGE_SIZE;
  const rects: ImageRect[] = [
    { x: 32, y: 32, w: W - 64, h: W - 64, radius: 40, stroke: INK.frame },
  ];
  const marks: ImageMark[] = [];
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
  text("My World Tour", MARGIN, 222, `400 40px ${SANS}`, INK.dim);
  text(String(card.cleared), MARGIN, 380, `800 150px ${SIGN}`, INK.gold);
  text(
    card.complete
      ? `of ${card.total} continents · tour complete`
      : `of ${card.total} continents cleared against Atlas`,
    MARGIN,
    440,
    `400 40px ${SANS}`,
    INK.dim,
  );

  // The route as a line of stops in route order, numbered under each; a leg between two cleared
  // stops is flown in gold, the one into the next stop in sonar, the rest in the frame's ink.
  const n = card.legs.length;
  const left = MARGIN + 28;
  const span = W - 2 * left;
  const xAt = (i: number) => (n === 1 ? W / 2 : left + (span * i) / (n - 1));
  card.legs.slice(1).forEach((to, i) => {
    const from = card.legs[i];
    const flown = from.state === "cleared" && to.state === "cleared";
    const fill = flown ? INK.gold : to.state === "next" ? INK.sonar : INK.frame;
    rects.push({ x: xAt(i), y: ROUTE_Y - 4, w: xAt(i + 1) - xAt(i), h: 8, radius: 4, fill });
  });
  card.legs.forEach((leg, i) => {
    const { r, ring, fill } = STOP_LOOK[leg.state];
    rects.push({
      x: xAt(i) - r,
      y: ROUTE_Y - r,
      w: 2 * r,
      h: 2 * r,
      radius: r,
      fill,
      stroke: ring,
    });
    if (leg.state === "next")
      marks.push({ shape: "circle", x: xAt(i), y: ROUTE_Y, radius: 10, fill: INK.sonar });
    text(String(i + 1), xAt(i), ROUTE_Y + 58, `700 26px ${SANS}`, INK.dim, "center");
  });

  // Each leg: its number and continent, where it stands, and the best game's margin over Atlas.
  text("Best game against Atlas", W - MARGIN, LEGS_HEADING, `400 26px ${SANS}`, INK.dim, "right");
  const rowH = Math.min(48, (LEGS_BOTTOM - LEGS_TOP) / Math.max(n, 1));
  const size = Math.round(Math.min(32, rowH * 0.66));
  card.legs.forEach((leg, i) => {
    const base = LEGS_TOP + i * rowH + rowH / 2 + size * 0.36;
    const name = leg.state === "cleared" ? INK.gold : INK.chalk;
    text(`${i + 1}  ${leg.continent}`, MARGIN, base, `700 ${size}px ${SANS}`, name);
    const word = STATE_WORD[leg.state];
    if (word.text) text(word.text, STATE_X, base, `400 ${size}px ${SANS}`, word.color);
    text(
      leadWords(leg.lead),
      W - MARGIN,
      base,
      `800 ${size}px ${SIGN}`,
      leadColor(leg.lead),
      "right",
    );
  });

  text(card.url.replace(/^https?:\/\//, ""), MARGIN, 1020, `400 28px ${SANS}`, INK.dim);
  return { width: W, height: W, background: INK.background, rects, marks, texts };
}

/** The picture's file name, with the count so a few saved over the tour sort apart. */
export function tourShareName(card: TourShareCard): string {
  return `whereabout-tour-${card.cleared}-of-${card.total}.png`;
}

/** What the note under the buttons says as the tour is drawn and sent. */
export const TOUR_SHARE_NOTE: Record<ImageOutcome | "drawing", string> = {
  drawing: "Drawing your tour…",
  shared: "Tour shared.",
  downloaded: "Tour saved as a picture. Its counts and the link are copied too.",
  cancelled: "",
  failed: "Couldn't draw the picture in this browser. Share your tour as text instead.",
};

/**
 * Draw the tour and send it with its text line. Where the picture is saved rather than shared,
 * the text is copied too, so the link to the tour goes with it.
 */
export async function sendTourShare(
  card: TourShareCard,
  nav: Navigator = navigator,
): Promise<ImageOutcome> {
  try {
    const blob = await renderLayout(tourShareLayout(card));
    if (!blob) return "failed";
    const text = tourShareText(card);
    const outcome = await sendShareImage(blob, tourShareName(card), text, nav);
    if (outcome === "downloaded") await nav.clipboard?.writeText(text).catch(() => {});
    return outcome;
  } catch {
    return "failed";
  }
}
