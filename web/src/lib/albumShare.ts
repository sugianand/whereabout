/**
 * Share your album: a picture of how full each continent's page is, with your closest finds, and
 * a text line of the counts to go with it.
 *
 * Like the other share pictures (src/lib/shareImage.ts, src/lib/headToHead.ts) it is drawn only
 * from numbers and fixed words: the count of photos found, each continent's name with its count,
 * and your closest finds as a distance and a continent, never a photo, a place, a country, a photo
 * id or a coordinate. A friend who is later dealt one of your photos learns nothing about it from
 * your album. albumShare.test.ts holds every word drawn to that against the whole catalog.
 */
import type { Album } from "@/lib/album";
import { percentFound } from "@/lib/album";
import type { Continent } from "@/lib/continents";
import { formatDistance } from "@/lib/geo";
import type { Units } from "@/lib/units";

import { distanceBand } from "./share";
import {
  IMAGE_SIZE,
  INK,
  SANS,
  SIGN,
  bandColor,
  bandShape,
  renderLayout,
  sendShareImage,
  type ImageMark,
  type ImageOutcome,
  type ImageRect,
  type ImageText,
  type ShareImageLayout,
} from "./shareImage";

/** How many of your closest finds the picture shows. */
export const CLOSEST_SHOWN = 3;

export interface AlbumSharePage {
  continent: Continent;
  found: number;
  total: number;
}

/** One of your closest finds: how far off your pin landed, and on which continent. */
export interface AlbumShareFind {
  continent: Continent;
  km: number;
}

export interface AlbumShareCard {
  found: number;
  total: number;
  pages: AlbumSharePage[];
  /** Closest first; finds with no pin (a Blitz clock that ran out) are never among them. */
  closest: AlbumShareFind[];
  /** The game's home page, to play from. */
  url: string;
}

/**
 * The game's home page from the album's address: "https://example.org/whereabout/album/" becomes
 * "https://example.org/whereabout/", with any query or hash dropped.
 */
export function albumHome(href: string): string {
  const url = new URL(href);
  const path = url.pathname.replace(/album\/?$/, "");
  return `${url.origin}${path.endsWith("/") ? path : `${path}/`}`;
}

/** The counts and closest finds of an album, and nothing else about its photos. */
export function albumShareCard(album: Album, href: string): AlbumShareCard {
  const closest = album.continents
    .flatMap((row) =>
      row.found.flatMap((p) => (p.km === null ? [] : [{ continent: row.continent, km: p.km }])),
    )
    .sort((a, b) => a.km - b.km)
    .slice(0, CLOSEST_SHOWN);
  return {
    found: album.found,
    total: album.total,
    pages: album.continents.map((row) => ({
      continent: row.continent,
      found: row.found.length,
      total: row.total,
    })),
    closest,
    url: albumHome(href),
  };
}

const count = (n: number) => n.toLocaleString("en-US");

/** "Whereabout album: 12 of 340 photos found", every page's count, then where to play. */
export function albumShareText(card: AlbumShareCard): string {
  return [
    `Whereabout album: ${count(card.found)} of ${count(card.total)} photos found`,
    card.pages.map((p) => `${p.continent} ${count(p.found)}/${count(p.total)}`).join(" · "),
    card.url,
  ].join("\n");
}

/** The words for a screen reader beside the button, and for the tests. */
export function albumShareSummary(card: Pick<AlbumShareCard, "found" | "total">): string {
  return `Your album: ${count(card.found)} of ${count(card.total)} photos found.`;
}

const MARGIN = 96;
const PAGES_TOP = 500;
const PAGES_BOTTOM = 790;
const BAR_X = 390;
const BAR_W = 420;
const CLOSEST_TOP = 840;

/** Every shape and word of the album picture, in paint order. */
export function albumShareLayout(card: AlbumShareCard, units: Units = "km"): ShareImageLayout {
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
  text("My album", MARGIN, 222, `400 40px ${SANS}`, INK.dim);
  text(count(card.found), MARGIN, 380, `800 150px ${SIGN}`, INK.gold);
  const pct = percentFound(card.found, card.total);
  text(`of ${count(card.total)} photos found · ${pct}%`, MARGIN, 440, `400 40px ${SANS}`, INK.dim);

  // Each continent's page: its name, a bar of how full it is and the count, a full page in sonar.
  const n = Math.max(card.pages.length, 1);
  const rowH = Math.min(52, (PAGES_BOTTOM - PAGES_TOP) / n);
  const size = Math.round(Math.min(30, rowH * 0.62));
  card.pages.forEach((p, i) => {
    const mid = PAGES_TOP + i * rowH + rowH / 2;
    const full = p.total > 0 && p.found >= p.total;
    const ink = full ? INK.sonar : INK.chalk;
    text(p.continent, MARGIN, mid + size * 0.36, `700 ${size}px ${SANS}`, ink);
    const barH = Math.max(8, Math.round(rowH * 0.28));
    rects.push({
      x: BAR_X,
      y: mid - barH / 2,
      w: BAR_W,
      h: barH,
      radius: barH / 2,
      fill: INK.frame,
    });
    if (p.found > 0 && p.total > 0) {
      // Never narrower than its own rounded ends, so one photo found still shows.
      const w = Math.max(barH, (BAR_W * Math.min(p.found, p.total)) / p.total);
      rects.push({
        x: BAR_X,
        y: mid - barH / 2,
        w,
        h: barH,
        radius: barH / 2,
        fill: full ? INK.sonar : INK.gold,
      });
    }
    text(
      `${count(p.found)} / ${count(p.total)}`,
      W - MARGIN,
      mid + size * 0.36,
      `700 ${size}px ${SANS}`,
      ink,
      "right",
    );
  });

  // Your closest finds, side by side: the band's shape and colour, the distance, the continent.
  if (card.closest.length > 0) {
    text("Closest finds", MARGIN, CLOSEST_TOP, `400 30px ${SANS}`, INK.dim);
    const colW = (W - 2 * MARGIN) / CLOSEST_SHOWN;
    card.closest.slice(0, CLOSEST_SHOWN).forEach((f, i) => {
      const x = MARGIN + i * colW;
      const band = distanceBand(f.km);
      marks.push({
        shape: bandShape(band),
        x: x + 16,
        y: CLOSEST_TOP + 48,
        radius: 16,
        fill: bandColor(band),
      });
      text(formatDistance(f.km, units), x + 44, CLOSEST_TOP + 60, `800 40px ${SIGN}`, INK.chalk);
      text(f.continent, x + 44, CLOSEST_TOP + 98, `400 26px ${SANS}`, INK.dim);
    });
  }

  text(card.url.replace(/^https?:\/\//, ""), MARGIN, 1020, `400 28px ${SANS}`, INK.dim);
  return { width: W, height: W, background: INK.background, rects, marks, texts };
}

/** The picture's file name, with the count so a few saved over time sort apart. */
export function albumShareName(card: AlbumShareCard): string {
  return `whereabout-album-${card.found}-of-${card.total}.png`;
}

/** What the note under the buttons says as the album is drawn and sent. */
export const ALBUM_SHARE_NOTE: Record<ImageOutcome | "drawing", string> = {
  drawing: "Drawing your album…",
  shared: "Album shared.",
  downloaded: "Album saved as a picture. Its counts and the link are copied too.",
  cancelled: "",
  failed: "Couldn't draw the picture in this browser. Share your album as text instead.",
};

/**
 * Draw the album and send it with its text line. Where the picture is saved rather than shared,
 * the text is copied too, so the link to play goes with it.
 */
export async function sendAlbumShare(
  card: AlbumShareCard,
  units: Units,
  nav: Navigator = navigator,
): Promise<ImageOutcome> {
  try {
    const blob = await renderLayout(albumShareLayout(card, units));
    if (!blob) return "failed";
    const text = albumShareText(card);
    const outcome = await sendShareImage(blob, albumShareName(card), text, nav);
    if (outcome === "downloaded") await nav.clipboard?.writeText(text).catch(() => {});
    return outcome;
  } catch {
    return "failed";
  }
}
