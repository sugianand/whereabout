/**
 * Pocket Atlas's eyes: CLIP ViT-B/32's image encoder, run in the browser by transformers.js.
 *
 * transformers.js is loaded from a pinned CDN build only when someone opens "Your photo"; it is
 * not an npm dependency, because its npm package pulls in Node-only native modules (sharp,
 * onnxruntime-node) that a static site never runs. The model weights come from the Hugging
 * Face Hub on first use and are cached by the browser after that.
 *
 * Nothing leaves the device: the photo is decoded, embedded and matched locally.
 */
import { normalise } from "./locate";
import { clipPixels } from "./preprocess";
import type { Pixels } from "./saliency";

/**
 * The self-contained build, with ONNX Runtime bundled in. Not `transformers.web.min.js`: that one
 * imports "onnxruntime-web/webgpu" by bare name, which a browser cannot resolve without an
 * import map, so Pocket Atlas failed on every photo.
 */
export const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

/** A transformers.js tensor, as far as the encoder uses one. */
export interface TensorLike {
  data: ArrayLike<number>;
  dims: number[];
}

/** What the encoder needs from transformers.js (a tiny, typed slice of its API). */
export interface TransformersLib {
  env: { allowLocalModels: boolean };
  CLIPVisionModelWithProjection: {
    from_pretrained(
      id: string,
      opts?: object,
    ): Promise<(inputs: { pixel_values: TensorLike }) => Promise<{ image_embeds: TensorLike }>>;
  };
  /** Decodes through the browser, which turns the photo upright by its EXIF tag. */
  RawImage: {
    fromBlob(blob: Blob): Promise<{
      data: ArrayLike<number>;
      width: number;
      height: number;
      channels: number;
    }>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => TensorLike;
}

export interface DownloadProgress {
  /** Bytes fetched so far and the total, summed across the model's files. */
  loaded: number;
  total: number;
}

/** The pixels CLIP sees for a photo, and the photo's own size (to place the square on it). */
export interface PreparedPhoto {
  pixels: Pixels;
  width: number;
  height: number;
}

export interface ImageEncoder {
  embed(photo: Blob): Promise<Float32Array>;
  /** Decode and preprocess a photo (resize, centre-crop, normalise) without embedding it. */
  prepare(photo: Blob): Promise<PreparedPhoto>;
  /** Embed already-preprocessed pixels, e.g. a copy with part of the photo greyed out. */
  embedPixels(pixels: Pixels): Promise<Float32Array>;
}

/** Bypasses the bundler: the URL is fetched by the browser at runtime, not at build time. */
const importFromUrl = (url: string): Promise<TransformersLib> =>
  new Function("u", "return import(u)")(url) as Promise<TransformersLib>;

/** Sums transformers.js's per-file progress events into one figure for the whole download. */
export function progressTracker(onProgress: (p: DownloadProgress) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (event.status !== "progress" || !event.file) return;
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    onProgress({ loaded, total });
  };
}

export async function loadEncoder(
  modelId: string,
  onProgress: (p: DownloadProgress) => void = () => {},
  load: () => Promise<TransformersLib> = () => importFromUrl(TRANSFORMERS_URL),
): Promise<ImageEncoder> {
  const lib = await load();
  lib.env.allowLocalModels = false;
  // Half-precision weights (about 180 MB, half of full precision). The 8-bit build was half
  // that again, but it quantises activations on the fly and moved embeddings far enough from
  // PyTorch's that the parity test never passed (cosine 0.80 on the Atlas run's photo), so
  // Pocket Atlas was never published. fp16 matches full precision on the wasm backend.
  const model = await lib.CLIPVisionModelWithProjection.from_pretrained(modelId, {
    dtype: "fp16",
    device: "wasm",
    progress_callback: progressTracker(onProgress),
  });
  const run = async (pixel_values: TensorLike) => {
    const { image_embeds } = await model({ pixel_values });
    return normalise(Float32Array.from(image_embeds.data));
  };
  // CLIP's input is computed here, exactly as open_clip computes it (preprocess.ts), not by
  // transformers.js's processor: its canvas resize barely antialiases a big photo on the way
  // down to 224 px, which alone kept the parity test failing on a full-size catalog photo.
  const prepare = async (photo: Blob): Promise<PreparedPhoto> => {
    const { data, width, height, channels } = await lib.RawImage.fromBlob(photo);
    return { pixels: clipPixels(data, width, height, channels), width, height };
  };
  // Always a batch of one, so an edited copy is embedded exactly as the photo was, and a phone
  // holds one copy's activations at a time.
  const embedPixels = ({ data, dims }: Pixels) =>
    run(new lib.Tensor("float32", data, [1, ...dims]));
  return {
    embed: async (photo: Blob) => embedPixels((await prepare(photo)).pixels),
    prepare,
    embedPixels,
  };
}
