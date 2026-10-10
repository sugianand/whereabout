import { describe, expect, it, vi } from "vitest";

import { loadEncoder, progressTracker, type TransformersLib } from "./encoder";

function fakeLib(embedding: number[]) {
  const calls: { id: string; opts?: object }[] = [];
  const lib: TransformersLib = {
    env: { allowLocalModels: true },
    AutoProcessor: {
      async from_pretrained(id, opts) {
        calls.push({ id, opts });
        return async (img) => ({ pixel_values: img });
      },
    },
    CLIPVisionModelWithProjection: {
      async from_pretrained(id, opts) {
        calls.push({ id, opts });
        return async () => ({ image_embeds: { data: embedding } });
      },
    },
    RawImage: { fromBlob: vi.fn(async () => "decoded") },
  };
  return { lib, calls };
}

describe("loadEncoder", () => {
  it("loads the named model as 8-bit on wasm and returns unit-length embeddings", async () => {
    const { lib, calls } = fakeLib([3, 4]);
    const encoder = await loadEncoder("Xenova/clip-vit-base-patch32", undefined, async () => lib);
    expect(lib.env.allowLocalModels).toBe(false);
    expect(calls.map((c) => c.id)).toEqual([
      "Xenova/clip-vit-base-patch32",
      "Xenova/clip-vit-base-patch32",
    ]);
    expect(calls[1].opts).toMatchObject({ dtype: "q8", device: "wasm" });
    const v = await encoder.embed(new Blob(["x"]));
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(lib.RawImage.fromBlob).toHaveBeenCalledOnce();
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
