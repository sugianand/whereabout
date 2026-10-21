import { bundledById, bundledDeck } from "@/lib/game/bundled";
import { buildDeck, type Deck, type GameRecord } from "@/lib/game/deck";

/** Loads records from memory, the way the static files would serve them. */
export function memoryLoader(records: readonly GameRecord[] | ReadonlyMap<string, GameRecord>) {
  const byId =
    records instanceof Map
      ? (records as ReadonlyMap<string, GameRecord>)
      : new Map((records as readonly GameRecord[]).map((r) => [r.photo.id, r]));
  return async (ids: string[]) =>
    ids.map((id) => {
      const record = byId.get(id);
      if (!record) throw new Error(`No record for ${id}`);
      return record;
    });
}

/** Props that make <Game> play the site's real catalog without a network. */
export const bundledGame: { deck: Deck; loadRecords: (ids: string[]) => Promise<GameRecord[]> } = {
  deck: bundledDeck,
  loadRecords: memoryLoader(bundledById),
};

export function gameFor(records: readonly GameRecord[]) {
  return { deck: buildDeck(records), loadRecords: memoryLoader(records) };
}
