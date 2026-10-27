import type { Pixels } from "./saliency";

/**
 * What CLIP sees, computed exactly as open_clip computes it: resize the short side to 224 with
 * PIL's antialiased bicubic filter, centre-crop 224 × 224 as torchvision does, scale to [0, 1]
 * and normalise per channel.
 *
 * transformers.js's own processor resizes through a canvas, which barely antialiases a big
 * photo on the way down to 224 px: on a 12-megapixel phone photo that alone moved the browser's
 * embedding far enough from PyTorch's to fail Pocket Atlas's parity test. This is a port of
 * Pillow's Resample.c (fixed-point coefficients, horizontal pass then vertical, 8-bit rounding
 * between them), pinned to Pillow by data/fixtures/clip_preprocess_cases.json.
 */

export const CLIP_SIZE = 224;
export const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
export const CLIP_STD = [0.26862954, 0.26130258, 0.27577711] as const;

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;

/** Pillow's bicubic kernel (a = -0.5), support 2. */
export function bicubic(x: number): number {
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

interface Coeffs {
  ksize: number;
  /** [first input index, count] per output index. */
  bounds: Int32Array;
  /** Fixed-point weights, ksize per output index (integers held exactly in doubles). */
  kk: Float64Array;
}

/** Pillow's precompute_coeffs + normalize_coeffs_8bpc, for the whole input span. */
function coefficients(inSize: number, outSize: number): Coeffs {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 2 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Float64Array(outSize * ksize);
  const k = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      k[x] = bicubic((x + xmin - center + 0.5) / filterscale);
      ww += k[x];
    }
    for (let x = 0; x < xmax; x++) {
      const w = ww !== 0 ? k[x] / ww : k[x];
      // (int)(±0.5 + w * 2^22): C truncates toward zero.
      kk[xx * ksize + x] = Math.trunc(w < 0 ? -0.5 + w * ONE : 0.5 + w * ONE);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kk };
}

/** (ss >> 22) clamped to a byte, as Pillow's clip8. */
const clip8 = (ss: number) => Math.min(255, Math.max(0, Math.floor(ss / ONE)));

/**
 * Resize interleaved RGB bytes (any `channels` >= 3; extra channels such as alpha are dropped)
 * to outW × outH with Pillow's bicubic resample. Returns RGB bytes.
 */
export function resizeBicubic(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  outW: number,
  outH: number,
): Uint8Array {
  if (channels < 3) throw new Error(`need RGB pixels, got ${channels} channel(s)`);
  if (data.length !== width * height * channels) throw new Error("pixel data has the wrong size");
  const h = coefficients(width, outW);
  const v = coefficients(height, outH);
  // Only the rows the vertical pass reads go through the horizontal pass, as in Pillow.
  const yFirst = v.bounds[0];
  const yLast = v.bounds[outH * 2 - 2] + v.bounds[outH * 2 - 1];
  const rows = yLast - yFirst;
  const half = ONE / 2;

  const temp = new Uint8Array(outW * rows * 3);
  for (let y = 0; y < rows; y++) {
    const rowIn = (y + yFirst) * width;
    for (let xx = 0; xx < outW; xx++) {
      const xmin = h.bounds[xx * 2];
      const n = h.bounds[xx * 2 + 1];
      const off = xx * h.ksize;
      let s0 = half;
      let s1 = half;
      let s2 = half;
      for (let x = 0; x < n; x++) {
        const w = h.kk[off + x];
        const p = (rowIn + xmin + x) * channels;
        s0 += data[p] * w;
        s1 += data[p + 1] * w;
        s2 += data[p + 2] * w;
      }
      const o = (y * outW + xx) * 3;
      temp[o] = clip8(s0);
      temp[o + 1] = clip8(s1);
      temp[o + 2] = clip8(s2);
    }
  }

  const out = new Uint8Array(outW * outH * 3);
  for (let yy = 0; yy < outH; yy++) {
    const ymin = v.bounds[yy * 2] - yFirst;
    const n = v.bounds[yy * 2 + 1];
    const off = yy * v.ksize;
    for (let xx = 0; xx < outW; xx++) {
      let s0 = half;
      let s1 = half;
      let s2 = half;
      for (let y = 0; y < n; y++) {
        const w = v.kk[off + y];
        const p = ((ymin + y) * outW + xx) * 3;
        s0 += temp[p] * w;
        s1 += temp[p + 1] * w;
        s2 += temp[p + 2] * w;
      }
      const o = (yy * outW + xx) * 3;
      out[o] = clip8(s0);
      out[o + 1] = clip8(s1);
      out[o + 2] = clip8(s2);
    }
  }
  return out;
}

/** torchvision's Resize(size): the short side becomes `size`, the long side int(size·long/short). */
export function shortSideSize(width: number, height: number, size = CLIP_SIZE): [number, number] {
  if (!(width > 0 && height > 0)) throw new Error("image size must be positive");
  return width <= height
    ? [size, Math.trunc((size * height) / width)]
    : [Math.trunc((size * width) / height), size];
}

/** Python's round() for halves: to the even neighbour (torchvision's centre-crop offsets). */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** open_clip's preprocessing of decoded pixels: resize, centre-crop, normalise. [3, size, size]. */
export function clipPixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  size = CLIP_SIZE,
): Pixels {
  const [w, h] = shortSideSize(width, height, size);
  const rgb =
    w === width && h === height && channels === 3
      ? Uint8Array.from(data)
      : resizeBicubic(data, width, height, channels, w, h);
  const top = roundHalfEven((h - size) / 2);
  const left = roundHalfEven((w - size) / 2);
  const out = new Float32Array(3 * size * size);
  for (let c = 0; c < 3; c++) {
    const mean = CLIP_MEAN[c];
    const std = CLIP_STD[c];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = rgb[((y + top) * w + x + left) * 3 + c] / 255;
        out[(c * size + y) * size + x] = (v - mean) / std;
      }
    }
  }
  return { data: out, dims: [3, size, size] };
}
