/**
 * Where Close-up looks, and how the crop sits in its frame.
 *
 * A crop of empty sky would be a coin toss, so the tightest crop opens on the busiest part of the
 * photo: `busiestFocus` reads a small copy of it and takes the window with the most edges.
 * Photos are hot-linked from Wikimedia, so reading one takes a CORS request that can fail, and a
 * blank photo has nowhere busiest; `seededFocus` then picks a spot in the lower middle, where the
 * ground usually is.
 *
 * `cropView` lays the photo out so that every stage fills the frame, with the photo's own edges
 * never pulled inside it, and the reveal shows the whole photo. One transform serves them all, so
 * going from stage to stage is a single CSS transition.
 */

import { thumbUrl } from "@/lib/photoSources";

import { hashSeed } from "./daily";

/** A point on the photo, as fractions of its width and height. */
export interface Focus {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** How far past filling the frame each stage is zoomed: 0, 1 and 2 wrong names. */
export const CLOSE_ZOOMS = [4, 2.5, 1.5] as const;
/** The window the busiest spot is sought with, as a share of the photo: about the tightest crop. */
const WINDOW = 1 / CLOSE_ZOOMS[0];
/** Width of the copy read for its edges, and the Wikimedia thumbnail it is drawn from. */
export const FOCUS_SAMPLE = 64;
const FOCUS_THUMB = 330;

/** The centre of the window of `luma` (`width` by `height`) with the most edges; null if blank. */
export function busiestFocus(
  luma: ArrayLike<number>,
  width: number,
  height: number,
): Focus | null {
  // Summed-area table of each pixel's edge strength, so every window costs four lookups.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const dx = x + 1 < width ? Math.abs(luma[at + 1] - luma[at]) : 0;
      const dy = y + 1 < height ? Math.abs(luma[at + width] - luma[at]) : 0;
      const i = (y + 1) * stride + x + 1;
      sums[i] = dx + dy + sums[i - 1] + sums[i - stride] - sums[i - stride - 1];
    }
  }
  const w = Math.max(1, Math.round(width * WINDOW));
  const h = Math.max(1, Math.round(height * WINDOW));
  let best = 0;
  let focus: Focus | null = null;
  for (let y = 0; y + h <= height; y++) {
    for (let x = 0; x + w <= width; x++) {
      const a = y * stride + x;
      const b = (y + h) * stride + x;
      const energy = sums[b + w] - sums[b] - sums[a + w] + sums[a];
      if (energy > best) {
        best = energy;
        focus = { x: (x + w / 2) / width, y: (y + h / 2) / height };
      }
    }
  }
  return focus;
}

/** A spot in the lower middle of the photo, pure in `seed`. */
export function seededFocus(seed: number): Focus {
  const unit = (salt: string) => hashSeed(`whereabout:close-up:${seed}:${salt}`) / 2 ** 32;
  return { x: 0.3 + unit("x") * 0.4, y: 0.45 + unit("y") * 0.3 };
}

/**
 * The busiest spot of the photo at `imageUrl`, or null when it can't be read. Reads a small
 * thumbnail, never the photo on screen: asking for that with CORS would refuse a copy already
 * kept without it, and the game has to work either way.
 */
export function readFocus(imageUrl: string): Promise<Focus | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const width = FOCUS_SAMPLE;
        const height = Math.max(
          1,
          Math.round((width * image.naturalHeight) / (image.naturalWidth || 1)),
        );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        const luma = new Float32Array(width * height);
        for (let i = 0; i < luma.length; i++) {
          luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        }
        resolve(busiestFocus(luma, width, height));
      } catch {
        resolve(null);
      }
    };
    image.src = thumbUrl(imageUrl, FOCUS_THUMB);
  });
}

/** Where the photo sits in the frame: a box, moved and scaled from its top left corner. */
export interface CropView {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

/** Centre a span in the frame, or if it overfills, bring `at` to the middle and keep it covered. */
function place(span: number, frame: number, at: number): number {
  if (span <= frame) return (frame - span) / 2;
  return Math.min(0, Math.max(frame - span, frame / 2 - at * span));
}

/**
 * How to show `image` in `frame`: `zoom` is how far past filling the frame to go, or null for the
 * whole photo, fitted inside it. The box is the fitted photo in both cases, so only the transform
 * changes.
 */
export function cropView(frame: Size, image: Size, focus: Focus, zoom: number | null): CropView {
  const fit = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const scale = zoom === null ? 1 : zoom * Math.max(frame.width / width, frame.height / height);
  return {
    width,
    height,
    x: place(width * scale, frame.width, focus.x),
    y: place(height * scale, frame.height, focus.y),
    scale,
  };
}
