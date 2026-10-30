/**
 * A round's postcard: one thing to learn about the place, shown at the reveal
 * (data/postcards/postcards.csv, folded into the catalog by scripts/build-catalog.mjs).
 */

import type { Postcard } from "@/lib/game/types";

/** The longest description the Postcards workflow writes (data/postcards/README.md). */
export const POSTCARD_MAX_CHARS = 240;

/** Only English Wikipedia articles are linked, by their canonical address. */
const WIKIPEDIA_URL = /^https:\/\/en\.wikipedia\.org\/wiki\/[^\s"<>]+$/;

/** Whether an address is an English Wikipedia article, the only kind a postcard links to. */
export function isWikipediaUrl(url: unknown): url is string {
  return typeof url === "string" && WIKIPEDIA_URL.test(url);
}

/**
 * Whether a value read back from storage is a postcard as the catalog writes it: a description
 * of 1 to 240 characters, an English Wikipedia article with a title, or both, and nothing else.
 */
export function isPostcard(v: unknown): v is Postcard {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const { description, article, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return false;
  if (description === undefined && article === undefined) return false;
  if (
    description !== undefined &&
    !(
      typeof description === "string" &&
      description.trim() !== "" &&
      description.length <= POSTCARD_MAX_CHARS
    )
  ) {
    return false;
  }
  if (article !== undefined) {
    if (typeof article !== "object" || article === null) return false;
    const { title, url } = article as Record<string, unknown>;
    if (typeof title !== "string" || title.trim() === "" || !isWikipediaUrl(url)) return false;
  }
  return true;
}
