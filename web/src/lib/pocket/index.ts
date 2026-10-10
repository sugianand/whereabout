import { decodeIndex, type PocketIndex, type PocketMeta } from "./locate";

/** Where the Atlas workflow publishes the text index (web/public/pocket-atlas/). */
export function pocketUrl(
  file: "index.json" | "vectors.bin",
  basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  return `${basePath.replace(/\/$/, "")}/pocket-atlas/${file}`;
}

/** Thrown when the index hasn't been generated yet (no Atlas run since Pocket Atlas shipped). */
export class IndexUnavailable extends Error {}

export async function loadIndex(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<PocketIndex> {
  const [metaRes, binRes] = await Promise.all([
    fetchImpl(pocketUrl("index.json")),
    fetchImpl(pocketUrl("vectors.bin")),
  ]);
  if (metaRes.status === 404 || binRes.status === 404) {
    throw new IndexUnavailable("Pocket Atlas's index hasn't been published yet.");
  }
  if (!metaRes.ok || !binRes.ok) throw new Error("Couldn't load Pocket Atlas. Try again.");
  const meta = (await metaRes.json()) as PocketMeta;
  return decodeIndex(meta, new Int8Array(await binRes.arrayBuffer()));
}
