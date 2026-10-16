/**
 * Which catalog photos the game deals.
 *
 * Whereabout is a match against Atlas, so a round needs Atlas's precomputed guess for its photo.
 * Photos merged into the catalog from the Commons harvest arrive before the Atlas workflow has
 * guessed them; until it has, they wait in the catalog instead of opening rounds Atlas sits out.
 * With no guesses at all (a fresh checkout before the first Atlas run) every photo plays, so the
 * game still works on its own.
 */

import type { AtlasData } from "./types";

type HasId = { id: string };

export function playablePhotos<T extends HasId>(
  catalog: readonly T[],
  atlas: Pick<AtlasData, "guesses">,
): T[] {
  const guessed = catalog.filter((p) => Object.hasOwn(atlas.guesses, p.id));
  return guessed.length > 0 ? guessed : [...catalog];
}
