/**
 * The share card as a picture: the same spoiler-free numbers as the text card (src/lib/share.ts),
 * drawn on a square canvas so it can go into a chat or a story as an image. Like the text card it
 * is built only from the card's numbers and fixed words, never a place, a photo or a coordinate;
 * shareImage.test.ts holds every word drawn to that against the whole catalog.
 *
 * The drawing is split in two: `shareImageLayout` decides every shape and word (pure, tested), and
 * `drawShareImage` only paints a layout onto a 2D context.
 */
import { markGeometry, markShapeAt, type MarkShape } from "@/lib/closenessMarks";
import { formatDistance, formatPoints } from "@/lib/geo";
import type { Units } from "@/lib/units";

import { DISTANCE_BANDS, type DistanceBand, type ShareCard, type Versus } from "./share";

/** Square, the size chat apps and stories show without cropping. */
export const IMAGE_SIZE = 1080;

export const INK = {
  background: "#082331",
  frame: "#2a5b6e",
  chalk: "#eef4f2",
  dim: "#a9c2c8",
  flare: "#ff5d8f",
  sonar: "#4fe3c1",
  gold: "#ffc53d",
};

export const SIGN = '"Big Shoulders Display Variable", "Arial Narrow", sans-serif';
export const SANS = '"Atkinson Hyperlegible Next Variable", system-ui, sans-serif';

/**
 * One colour per distance band, closest first, in the order of DISTANCE_BANDS: green, yellow,
 * orange and red like the text card's squares, but picked to stay apart for protanopia,
 * deuteranopia and tritanopia (shareImage.test.ts checks them with `lib/colorVision.ts`). Each
 * band also has its own shape (`lib/closenessMarks.ts`), drawn on its tile and in the legend.
 */
export const BAND_COLORS: readonly string[] = ["#4fe3c1", "#ffe066", "#ff8c42", "#d6336c"];

/** Who got closer on a round, in words, since emoji draw differently on every phone. */
export const VERSUS_WORD: Record<Versus, { text: string; color: string }> = {
  won: { text: "You", color: INK.sonar },
  lost: { text: "Atlas", color: INK.flare },
  tied: { text: "Tie", color: INK.gold },
  none: { text: "–", color: INK.dim },
};

/** The legend under the tiles: each band's upper bound in the player's units, then "further". */
export function legendLabels(units: Units = "km"): string[] {
  return [
    ...DISTANCE_BANDS.filter((b) => Number.isFinite(b.maxKm)).map((b) =>
      formatDistance(b.maxKm, units),
    ),
    "further",
  ];
}

function bandIndex(band: DistanceBand): number {
  const i = DISTANCE_BANDS.indexOf(band);
  return i < 0 ? BAND_COLORS.length - 1 : i;
}

export function bandColor(band: DistanceBand): string {
  return BAND_COLORS[bandIndex(band)];
}

/** The band's shape, the same on its tile, in the legend and on Your map. */
export function bandShape(band: DistanceBand): MarkShape {
  return markShapeAt(bandIndex(band));
}

export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  fill?: string;
  stroke?: string;
}

export interface ImageText {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align: "left" | "center" | "right";
}

/** A closeness band's shape, centred on (x, y) and `radius` from it to the edge of its box. */
export interface ImageMark {
  shape: MarkShape;
  x: number;
  y: number;
  radius: number;
  fill: string;
}

export interface ShareImageLayout {
  width: number;
  height: number;
  background: string;
  rects: ImageRect[];
  /** Painted over the rects, under the words. */
  marks?: ImageMark[];
  texts: ImageText[];
}

const MARGIN = 96;
const TILE = 150;

/** Every shape and word of the picture, in paint order. */
export function shareImageLayout(card: ShareCard, units: Units = "km"): ShareImageLayout {
  const W = IMAGE_SIZE;
  const rects: ImageRect[] = [
    { x: 32, y: 32, w: W - 64, h: W - 64, radius: 40, stroke: INK.frame },
  ];
  const texts: ImageText[] = [];
  const marks: ImageMark[] = [];
  const text = (t: string, x: number, y: number, font: string, color: string, align = "left") =>
    texts.push({ text: t, x, y, font, color, align: align as ImageText["align"] });

  text("WHEREABOUT", MARGIN, 160, `800 64px ${SIGN}`, INK.chalk);
  text(card.title, MARGIN, 222, `400 40px ${SANS}`, INK.dim);
  text(formatPoints(card.score), MARGIN, 420, `800 176px ${SIGN}`, INK.flare);
  text(`out of ${formatPoints(card.maxScore)} points`, MARGIN, 478, `400 40px ${SANS}`, INK.dim);

  // The rounds, one tile each, spread across the width between the margins.
  const n = Math.max(card.rounds.length, 1);
  const gap = n > 1 ? Math.min(40, (W - 2 * MARGIN - n * TILE) / (n - 1)) : 0;
  const rowWidth = n * TILE + (n - 1) * gap;
  const left = (W - rowWidth) / 2;
  const top = 540;
  card.rounds.forEach((r, i) => {
    const x = left + i * (TILE + gap);
    rects.push({ x, y: top, w: TILE, h: TILE, radius: 24, fill: bandColor(r.band) });
    // The band's shape above the round's number, in the tile's dark ink, so the tile says how
    // close it was without its colour.
    marks.push({
      shape: bandShape(r.band),
      x: x + TILE / 2,
      y: top + 46,
      radius: 24,
      fill: INK.background,
    });
    text(String(i + 1), x + TILE / 2, top + 122, `800 64px ${SIGN}`, INK.background, "center");
    if (card.atlasRounds > 0) {
      const v = VERSUS_WORD[r.versus];
      text(v.text, x + TILE / 2, top + TILE + 56, `700 36px ${SANS}`, v.color, "center");
    }
  });

  let y = top + TILE + (card.atlasRounds > 0 ? 136 : 80);
  if (card.atlasRounds > 0) {
    text(
      `Beat Atlas in ${card.playerWins} of ${card.atlasRounds} rounds`,
      MARGIN,
      y,
      `700 40px ${SANS}`,
      INK.chalk,
    );
    y += 52;
  }
  if (card.hintsUsed > 0) {
    const hints = `${card.hintsUsed} ${card.hintsUsed === 1 ? "hint" : "hints"} taken`;
    text(hints, MARGIN, y, `400 32px ${SANS}`, INK.dim);
  }

  // How close each shape and colour means, then where to play.
  const legendY = 968;
  let lx = MARGIN;
  legendLabels(units).forEach((label, i) => {
    marks.push({
      shape: markShapeAt(i),
      x: lx + 15,
      y: legendY - 10,
      radius: 15,
      fill: BAND_COLORS[i],
    });
    text(label, lx + 40, legendY, `400 28px ${SANS}`, INK.dim);
    lx += 40 + label.length * 15 + 40;
  });
  text(card.url.replace(/^https?:\/\//, ""), MARGIN, 1020, `400 28px ${SANS}`, INK.dim);

  return { width: W, height: W, background: INK.background, rects, marks, texts };
}

/** The parts of CanvasRenderingContext2D the drawing uses, so tests can record it. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "fillRect"
  | "beginPath"
  | "roundRect"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
  | "fillText"
>;

export function drawShareImage(ctx: DrawingContext, layout: ShareImageLayout): void {
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const r of layout.rects) {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.radius);
    if (r.fill) {
      ctx.fillStyle = r.fill;
      ctx.fill();
    }
    if (r.stroke) {
      ctx.strokeStyle = r.stroke;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  for (const m of layout.marks ?? []) {
    const g = markGeometry(m.shape, m.x, m.y, m.radius);
    ctx.beginPath();
    if (g.kind === "circle") ctx.arc(g.cx, g.cy, g.r, 0, 2 * Math.PI);
    else {
      g.points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
    }
    ctx.fillStyle = m.fill;
    ctx.fill();
  }
  for (const t of layout.texts) {
    ctx.font = t.font;
    ctx.fillStyle = t.color;
    ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x, t.y);
  }
}

/**
 * Draw the card into a PNG. The page's fonts are loaded first so the canvas uses them, not a
 * fallback. Null where the browser has no 2D canvas or won't encode one.
 */
export async function renderShareImage(
  card: ShareCard,
  units: Units = "km",
  doc: Document = document,
): Promise<Blob | null> {
  const layout = shareImageLayout(card, units);
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

/** "whereabout-daily-five-october-9.png", from the card's title. */
export function shareImageName(card: ShareCard): string {
  const slug = card.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `whereabout${slug ? `-${slug}` : ""}.png`;
}

export type ImageOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/** The parts of `navigator` sharing a file needs. */
export interface ImageShareTarget {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

/** Save a file the ordinary way: a link with `download`, clicked. */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Send the picture with the share sheet where the browser says it can share files (phones,
 * mostly), with the text card's words and link alongside; otherwise save it as a download.
 * Closing the share sheet is a choice, not a failure; a share that fails otherwise downloads.
 */
export async function sendShareImage(
  blob: Blob,
  name: string,
  text: string,
  target: ImageShareTarget,
  save: (blob: Blob, name: string) => void = downloadBlob,
): Promise<ImageOutcome> {
  const file = new File([blob], name, { type: "image/png" });
  const data: ShareData = { files: [file], title: "Whereabout", text };
  if (typeof target.share === "function" && target.canShare?.(data)) {
    try {
      await target.share(data);
      return "shared";
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    save(blob, name);
    return "downloaded";
  } catch {
    return "failed";
  }
}
