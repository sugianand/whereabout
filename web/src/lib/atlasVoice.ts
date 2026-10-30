/**
 * Atlas's verdict line: one or two sentences in Atlas's own voice at every reveal, built only
 * from the round's real numbers (how sure Atlas was of its top country, whether that country
 * was right, and who got closer by how far), so the rival reads as a character without ever
 * saying anything the round didn't show.
 */
import { countryName } from "@/lib/countries";
import type { RoundResult } from "@/lib/game/state";
import { formatDistance } from "@/lib/geo";
import type { Units } from "@/lib/units";

/** At or above this (as a whole percent) Atlas calls itself sure of its country. */
export const SURE_PERCENT = 60;
/** Below this (as a whole percent) Atlas calls its country a hunch. */
export const HUNCH_PERCENT = 30;
/** A winning margin under this many kilometres reads as a near thing. */
export const CLOSE_KM = 50;

type Played = RoundResult & { atlas: NonNullable<RoundResult["atlas"]> };

/** A stable small number from the photo id, so a photo always gets the same phrasing. */
function seed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function choose(options: readonly string[], pick: number): string {
  return options[pick % options.length];
}

/** The percent Atlas gave its top country, as shown on the reveal: whole, never 0. */
export function surePercent(confidence: number): number {
  return Math.max(1, Math.min(100, Math.round(confidence * 100)));
}

/** How sure Atlas was of its top country and whether it was right, or null with no country. */
function surenessClause(result: Played, pick: number): string | null {
  const top = result.atlas.topCountries[0];
  if (!top) return null;
  const pct = `${surePercent(result.atlas.confidence)}%`;
  const said = countryName(top.country);
  const truthCode = result.reveal.answer.country;
  const right = truthCode !== null && truthCode === top.country;
  const band = surePercent(result.atlas.confidence);
  const truth = truthCode ? countryName(truthCode) : null;

  if (right) {
    if (band >= SURE_PERCENT)
      return choose(
        [`I was ${pct} sure it was ${said}, and it was.`, `${said}, ${pct} sure. Right country.`],
        pick,
      );
    if (band >= HUNCH_PERCENT) return `I leaned ${said} at ${pct}, and it was.`;
    return `${said} was only a ${pct} hunch, but it was the right country.`;
  }
  const was = truth ? `It was ${truth}.` : "Wrong country.";
  if (band >= SURE_PERCENT)
    return choose(
      [`I was ${pct} sure of ${said}. ${was}`, `${pct} on ${said}, and it wasn't. That stings.`],
      pick,
    );
  if (band >= HUNCH_PERCENT) return `I leaned ${said} at ${pct}. ${was}`;
  return `I was lost: ${said} at just ${pct}. ${was}`;
}

/** Who got closer and by how far, from Atlas's side; points decide, as on the card. */
function outcomeClause(result: Played, units: Units, pick: number): string {
  const { reveal, atlas } = result;
  const fmt = (km: number) => formatDistance(km, units);
  if (reveal.distanceKm === null)
    return `No pin from you, so I take it from ${fmt(atlas.distanceKm)} away.`;

  const margin = Math.abs(reveal.distanceKm - atlas.distanceKm);
  if (reveal.score === atlas.score) {
    if (reveal.score === 0) return "Neither of us scored a point.";
    return `Same points for us both, ${fmt(reveal.distanceKm)} and ${fmt(atlas.distanceKm)} out.`;
  }
  if (atlas.score > reveal.score) {
    // The player's pin was nearer but hints capped the round below Atlas's points.
    if (reveal.distanceKm < atlas.distanceKm && reveal.hintsUsed > 0)
      return `You were ${fmt(margin)} closer, but your hints cost you: I take it on points.`;
    if (margin < CLOSE_KM) return `I beat you by just ${fmt(margin)}.`;
    return choose([`I beat you by ${fmt(margin)}.`, `I was ${fmt(margin)} closer than you.`], pick);
  }
  if (margin < CLOSE_KM) return `You edged me by ${fmt(margin)}.`;
  return choose(
    [
      `You beat me by ${fmt(margin)}. Well played.`,
      `You were ${fmt(margin)} closer. I'll remember that.`,
    ],
    pick,
  );
}

/** Atlas's say on a round, in its two halves: how sure it was (null with no country), and the outcome. */
export interface AtlasSay {
  sure: string | null;
  outcome: string;
}

/**
 * Atlas's say on this round in the player's units, or null when Atlas sat the photo out.
 * `pick` chooses among equivalent phrasings; by default it comes from the photo id, so a
 * round reads the same when it is looked at again.
 */
export function atlasSay(result: RoundResult, units: Units, pick?: number): AtlasSay | null {
  if (!result.atlas) return null;
  const played = result as Played;
  const p = pick ?? seed(result.round.photo.id);
  return { sure: surenessClause(played, p), outcome: outcomeClause(played, units, p >> 1) };
}

/** Atlas's say as one line, or null when Atlas sat the photo out. */
export function atlasLine(result: RoundResult, units: Units, pick?: number): string | null {
  const say = atlasSay(result, units, pick);
  if (!say) return null;
  return say.sure ? `${say.sure} ${say.outcome}` : say.outcome;
}
