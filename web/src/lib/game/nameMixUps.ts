/**
 * Practise your mix-ups: a Name the country run dealt from the countries a player has taken for
 * each other most (`lib/mixUps.ts`), so the pairs they confuse come up until they tell them apart.
 *
 * Every photo dealt is in a country from one of the top pairs, and the country it was mixed up
 * with is always among its four names: a photo of Japan offers South Korea when those two were
 * confused, so the run asks the very question that was missed. The rest of the four come from
 * Name the country's own draw (`nameOptions`). Photos are dealt a country at a time in turn, so a
 * country with many photos never crowds out its partner. Like Name the country, everything is
 * worked out from a seed, so a re-render never reshuffles a run.
 *
 * The run keeps its own best, apart from free runs: the photos are picked for being hard for this
 * player, so the two bests mean different things. Wrong names in a practice run are kept as
 * mix-ups like any other, so a pair keeps coming back while it is still being missed.
 */

import { hashSeed, seededShuffle } from "./daily";
import { NAME_OPTIONS, nameOptions, type CountryPool } from "./nameCountry";
import { mixUpPairs, type MixUp } from "@/lib/mixUps";

export const BEST_MIX_UPS_KEY = "whereabout:name-country-mix-ups-best";

/** A practice run is offered once it can deal at least this many photos. */
export const MIN_PRACTICE_PHOTOS = 3;

/** Photo id to its country (ISO alpha-2), for the photos Name the country can deal. */
export type PhotoCountries = Readonly<Record<string, string>>;

/**
 * Each country in the player's top pairs, with the countries it was mixed up with, the pair
 * mixed up most first. A country in two pairs has two partners.
 */
export function practicePartners(log: readonly MixUp[]): Map<string, string[]> {
  const partners = new Map<string, string[]>();
  for (const { a, b } of mixUpPairs(log)) {
    (partners.get(a) ?? partners.set(a, []).get(a)!).push(b);
    (partners.get(b) ?? partners.set(b, []).get(b)!).push(a);
  }
  return partners;
}

/** The photos a practice run can deal, in deck order: those in a country of the top pairs. */
export function practiceIds(
  ids: readonly string[],
  countries: PhotoCountries,
  partners: ReadonlyMap<string, readonly string[]>,
): string[] {
  return ids.filter((id) => partners.has(countries[id]));
}

/** How many photos each country has to deal, for offering a run without a deck at hand. */
export function photosByCountry(countries: PhotoCountries): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const country of Object.values(countries)) counts[country] = (counts[country] ?? 0) + 1;
  return counts;
}

/** How many photos a practice run from `log` would deal, given each country's photo count. */
export function practiceSize(log: readonly MixUp[], counts: Readonly<Record<string, number>>) {
  let n = 0;
  for (const country of practicePartners(log).keys()) n += counts[country] ?? 0;
  return n;
}

/**
 * A run's order: each country's photos shuffled, then dealt a country at a time in a shuffled
 * turn, so every country in the pairs comes up within the first few photos. Pure in `seed`.
 */
export function practiceOrder(
  ids: readonly string[],
  countries: PhotoCountries,
  seed: number,
): string[] {
  const byCountry = new Map<string, string[]>();
  for (const id of ids) {
    const c = countries[id];
    (byCountry.get(c) ?? byCountry.set(c, []).get(c)!).push(id);
  }
  const turn = seededShuffle([...byCountry.keys()].sort(), seed);
  const stacks = turn.map((c) => seededShuffle(byCountry.get(c)!, hashSeed(`${seed}:${c}`)));
  const order: string[] = [];
  for (let i = 0; order.length < ids.length; i++) {
    for (const stack of stacks) if (i < stack.length) order.push(stack[i]);
  }
  return order;
}

/**
 * The four names for a practice photo: the truth, the countries it was mixed up with (most
 * mixed-up first, up to three), and the rest from Name the country's usual draw, shuffled.
 * Pure in `seed`.
 */
export function practiceOptions(
  truth: string,
  partners: readonly string[],
  pool: CountryPool,
  seed: number,
): string[] {
  const usual = nameOptions(truth, pool, seed).filter((c) => c !== truth);
  const foils = [...new Set(partners.filter((c) => c !== truth))].slice(0, NAME_OPTIONS - 1);
  const others = [...foils, ...usual.filter((c) => !foils.includes(c))].slice(0, NAME_OPTIONS - 1);
  return seededShuffle([truth, ...others], seed + 3);
}
