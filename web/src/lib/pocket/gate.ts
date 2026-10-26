import { normalise, type PocketMeta } from "./locate";

/**
 * Pocket Atlas's privacy gate: before Atlas guesses where your photo was taken, the scene gate's
 * people and indoor checks run on the same embedding, so a photo of people or of a room is
 * declined instead of placed on a map.
 *
 * A line-for-line port of `screen()` in ml/src/whereabout_ml/pocket_index.py, pinned to it by
 * data/fixtures/pocket_cases.json. Each check is the scene gate's log-odds,
 * `logitScale × image · (reject − accept)`; a reason is hit when it reaches its threshold, which
 * the Atlas workflow calibrates for this model on the hand-reviewed catalog photos
 * (data/scene_gate/pocket/).
 */

export type PrivacyReason = "people" | "indoor";

export interface PocketGate {
  logitScale: number;
  reasons: { name: PrivacyReason; threshold: number; direction: number[] }[];
}

export interface GateVerdict {
  passed: boolean;
  /** The reasons hit, in the index's order (people, then indoor). */
  reasons: PrivacyReason[];
  /** Log-odds per reason, rounded to 3 decimals like Python. */
  scores: Partial<Record<PrivacyReason, number>>;
}

const round3 = (x: number) => Math.round(x * 1e3) / 1e3;

/** The index's gate, or null for an index built before the gate (or a malformed one). */
export function gateOf(meta: PocketMeta): PocketGate | null {
  const g = meta.gate;
  if (!g || !Number.isFinite(g.logitScale) || !Array.isArray(g.reasons) || !g.reasons.length) {
    return null;
  }
  const sound = g.reasons.every(
    (r) => Number.isFinite(r.threshold) && r.direction?.length === meta.dim,
  );
  return sound ? g : null;
}

export function screen(gate: PocketGate, image: ArrayLike<number>): GateVerdict {
  const img = normalise(Float64Array.from(image));
  const scores: GateVerdict["scores"] = {};
  const reasons: PrivacyReason[] = [];
  for (const r of gate.reasons) {
    if (r.direction.length !== img.length) {
      throw new Error(`embedding has ${img.length} dims, not ${r.direction.length}`);
    }
    let dot = 0;
    for (let d = 0; d < img.length; d++) dot += r.direction[d] * img[d];
    const score = gate.logitScale * dot;
    scores[r.name] = round3(score);
    if (score >= r.threshold) reasons.push(r.name);
  }
  return { passed: reasons.length === 0, reasons, scores };
}

/** What the player reads when Atlas declines their photo. */
export function declineMessage(reasons: readonly PrivacyReason[]): string {
  const people = reasons.includes("people");
  const indoor = reasons.includes("indoor");
  const what =
    people && indoor
      ? "there are people in it, and it looks like it was taken indoors"
      : people
        ? "there are people in it"
        : "it looks like it was taken indoors";
  return (
    `Atlas won't guess this one: ${what}. Pocket Atlas only places photos of outdoor places, so ` +
    "it never says where a person is, or where someone's home might be. Try a landscape or a " +
    "street with nobody in it."
  );
}
