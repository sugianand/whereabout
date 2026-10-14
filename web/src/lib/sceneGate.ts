/** Which scene-gate reasons are working, from the calibration report's real fixture counts. */

export type GateCounts = { n: number; caught: number; caught_for_label: number };

/**
 * Splits reasons into those that catch at least half of their labelled test images for the
 * right reason ("strong") and those that do not ("weak"). Reasons with no test images are left
 * out of both, since there is nothing to judge them by. Order follows `reasons`.
 */
export function gateStrength<K extends string>(
  rejects: Partial<Record<K, GateCounts>>,
  reasons: readonly K[],
): { strong: K[]; weak: K[] } {
  const strong: K[] = [];
  const weak: K[] = [];
  for (const key of reasons) {
    const r = rejects[key];
    if (!r || r.n === 0) continue;
    (2 * r.caught_for_label >= r.n ? strong : weak).push(key);
  }
  return { strong, weak };
}

/** "a", "a and b", "a, b and c". */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
