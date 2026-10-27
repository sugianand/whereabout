import { describe, expect, it, vi } from "vitest";

import { TRANSFORMERS_URL, loadEncoder, progressTracker, type TransformersLib } from "./encoder";

function fakeLib(embedding: number[]) {
  const calls: { id: string; opts?: object }[] = [];
  const lib: TransformersLib = {
    env: { allowLocalModels: true },
    AutoProcessor: {
      async from_pretrained(id, opts) {
        calls.push({ id, opts });
        return async () => ({
          pixel_values: { data: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), dims: [1, 2, 2, 2] },
        });
      },
    },
    CLIPVisionModelWithProjection: {
      async from_pretrained(id, opts) {
        calls.push({ id, opts });
        return async (inputs) => {
          inputsSeen.push(inputs.pixel_values);
          return { image_embeds: { data: embedding, dims: [1, embedding.length] } };
        };
      },
    },
    RawImage: { fromBlob: vi.fn(async () => ({ width: 640, height: 480 })) },
    Tensor: class {
      constructor(
        public type: "float32",
        public data: Float32Array,
        public dims: number[],
      ) {}
    },
  };
  const inputsSeen: { data: ArrayLike<number>; dims: number[] }[] = [];
  return { lib, calls, inputsSeen };
}

describe("loadEncoder", () => {
  it("loads the build of transformers.js that a browser can import on its own", () => {
    // `transformers.web.min.js` imports "onnxruntime-web/webgpu" by bare name, which a browser
    // cannot resolve without an import map: every photo failed with "Failed to resolve module
    // specifier". `transformers.min.js` bundles ONNX Runtime, so a plain import() works.
    expect(TRANSFORMERS_URL).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\d+\.\d+\.\d+\/dist\/transformers\.min\.js$/,
    );
  });

  it("loads the named model in half precision on wasm and returns unit-length embeddings", async () => {
    const { lib, calls } = fakeLib([3, 4]);
    const encoder = await loadEncoder("Xenova/clip-vit-base-patch32", undefined, async () => lib);
    expect(lib.env.allowLocalModels).toBe(false);
    expect(calls.map((c) => c.id)).toEqual([
      "Xenova/clip-vit-base-patch32",
      "Xenova/clip-vit-base-patch32",
    ]);
    expect(calls[1].opts).toMatchObject({ dtype: "fp16", device: "wasm" });
    const v = await encoder.embed(new Blob(["x"]));
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(lib.RawImage.fromBlob).toHaveBeenCalledOnce();
  });

  it("hands out CLIP's preprocessed pixels and embeds edited copies one photo at a time", async () => {
    const { lib, inputsSeen } = fakeLib([0, 2]);
    const encoder = await loadEncoder("Xenova/clip-vit-base-patch32", undefined, async () => lib);
    const prepared = await encoder.prepare(new Blob(["x"]));
    expect(prepared.width).toBe(640);
    expect(prepared.height).toBe(480);
    expect(prepared.pixels.dims).toEqual([2, 2, 2]);
    expect(Array.from(prepared.pixels.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const greyed = {
      ...prepared.pixels,
      data: prepared.pixels.data.map((v, i) => (i < 4 ? 0 : v)),
    };
    expect(Array.from(await encoder.embedPixels(greyed))).toEqual([0, 1]);
    // A batch of one, with the edited pixels.
    expect(inputsSeen.at(-1)!.dims).toEqual([1, 2, 2, 2]);
    expect(Array.from(inputsSeen.at(-1)!.data)).toEqual([0, 0, 0, 0, 5, 6, 7, 8]);
  });
});

describe("progressTracker", () => {
  it("sums progress across files and ignores other events", () => {
    const seen: { loaded: number; total: number }[] = [];
    const track = progressTracker((p) => seen.push(p));
    track({ status: "initiate", file: "a" });
    track({ status: "progress", file: "a", loaded: 10, total: 100 });
    track({ status: "progress", file: "b", loaded: 5, total: 50 });
    track({ status: "progress", file: "a", loaded: 100, total: 100 });
    expect(seen).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 15, total: 150 },
      { loaded: 105, total: 150 },
    ]);
  });
});
