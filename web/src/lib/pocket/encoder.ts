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

export const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.web.min.js";

/** What the encoder needs from transformers.js (a tiny, typed slice of its API). */
export interface TransformersLib {
  env: { allowLocalModels: boolean };
  AutoProcessor: {
    from_pretrained(id: string, opts?: object): Promise<(img: unknown) => Promise<object>>;
  };
  CLIPVisionModelWithProjection: {
    from_pretrained(
      id: string,
      opts?: object,
    ): Promise<(inputs: object) => Promise<{ image_embeds: { data: ArrayLike<number> } }>>;
  };
  RawImage: { fromBlob(blob: Blob): Promise<unknown> };
}

export interface DownloadProgress {
  /** Bytes fetched so far and the total, summed across the model's files. */
  loaded: number;
  total: number;
}

export interface ImageEncoder {
  embed(photo: Blob): Promise<Float32Array>;
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
  const progress_callback = progressTracker(onProgress);
  const [processor, model] = await Promise.all([
    lib.AutoProcessor.from_pretrained(modelId, { progress_callback }),
    // 8-bit weights: about a quarter of the download, for a small loss in agreement with
    // PyTorch that the parity test measures.
    lib.CLIPVisionModelWithProjection.from_pretrained(modelId, {
      dtype: "q8",
      device: "wasm",
      progress_callback,
    }),
  ]);
  return {
    async embed(photo: Blob) {
      const image = await lib.RawImage.fromBlob(photo);
      const { image_embeds } = await model(await processor(image));
      return normalise(Float32Array.from(image_embeds.data));
    },
  };
}
