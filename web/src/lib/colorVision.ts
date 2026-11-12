/**
 * How a colour looks to someone with colour-vision deficiency, so a palette that shows closeness
 * can be checked to stay readable for them. Only used by tests and the palettes' own checks; it
 * draws nothing.
 *
 * The simulation is Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency", at full severity, applied to linear sRGB. Differences
 * are measured in OKLab (Björn Ottosson, 2020), where a straight-line distance tracks how
 * different two colours look far better than RGB does.
 */

export type VisionKind = "typical" | "protanopia" | "deuteranopia" | "tritanopia";

export const VISION_KINDS: readonly VisionKind[] = [
  "typical",
  "protanopia",
  "deuteranopia",
  "tritanopia",
];

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Machado et al. (2009), severity 1.0, for linear RGB. */
const SIMULATION: Record<VisionKind, Matrix> = {
  typical: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

type Rgb = [number, number, number];

const HEX = /^#[0-9a-f]{6}$/i;

/** "#ffc53d" as linear-light RGB in 0..1. */
export function linearRgb(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
}

/** The colour as a viewer with `kind` vision sees it, in linear RGB (clamped to the gamut). */
export function simulate(hex: string, kind: VisionKind): Rgb {
  const c = linearRgb(hex);
  return SIMULATION[kind].map((row) =>
    Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])),
  ) as Rgb;
}

/** Linear RGB to OKLab [L, a, b]. */
export function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How different two colours look to a viewer with `kind` vision: the OKLab distance. */
export function seenDifference(a: string, b: string, kind: VisionKind): number {
  const [l1, a1, b1] = oklab(simulate(a, kind));
  const [l2, a2, b2] = oklab(simulate(b, kind));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The bar each closeness palette is held to: every pair of its colours at least this far apart in
 * OKLab, for typical vision and each of the three full dichromacies. It is this project's own
 * bar, about five times OKLab's just-noticeable difference of roughly 0.02, so neighbouring bands
 * read as different colours at a glance rather than on close comparison.
 */
export const MIN_SEPARATION = 0.1;

export interface Separation {
  kind: VisionKind;
  distance: number;
  pair: [string, string];
}

/** The closest-looking pair of a palette for each kind of vision. */
export function separations(palette: readonly string[]): Separation[] {
  return VISION_KINDS.map((kind) => {
    let best: Separation = { kind, distance: Infinity, pair: ["", ""] };
    palette.forEach((a, i) =>
      palette.slice(i + 1).forEach((b) => {
        const distance = seenDifference(a, b, kind);
        if (distance < best.distance) best = { kind, distance, pair: [a, b] };
      }),
    );
    return best;
  });
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
