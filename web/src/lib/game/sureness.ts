/**
 * How sure is Atlas, really? The reveal says "62% sure of the country"; this checks that number
 * against the photos the game ships: of every photo where Atlas was about that sure, how many did
 * it name the right country for?
 *
 * The bands are counted at build time from the same records players are dealt (the photo's true
 * country and Atlas's shortlist), so they always describe the probabilities the game actually
 * shows, whether atlas.yml shipped them temperature-scaled or raw
 * (ml/src/whereabout_ml/calibration.py).
 */

import type { GameRecord } from "./deck";

/** One band of Atlas's confidence, [lo, hi), with the top band closed at 1. */
export interface SurenessBand {
  lo: number;
  hi: number;
  /** Photos where Atlas's top country had a probability in this band. */
  n: number;
  /** Of those, how many were really taken in that country. */
  right: number;
}

export const SURENESS_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
/** Fewer photos than this in a band and the reveal says nothing: the share would be noise. */
export const MIN_BAND_PHOTOS = 10;

function bandIndex(confidence: number): number {
  const last = SURENESS_EDGES.length - 2;
  for (let i = 0; i < last; i++) if (confidence < SURENESS_EDGES[i + 1]) return i;
  return last;
}

/** Every band, empty ones included, from the photos Atlas guessed whose country is known. */
export function surenessBands(records: readonly GameRecord[]): SurenessBand[] {
  const bands = SURENESS_EDGES.slice(0, -1).map((lo, i) => ({
    lo,
    hi: SURENESS_EDGES[i + 1],
    n: 0,
    right: 0,
  }));
  for (const { photo, atlas } of records) {
    const top = atlas?.topCountries?.[0];
    if (!atlas || !top || !photo.country || !Number.isFinite(atlas.confidence)) continue;
    const band = bands[bandIndex(Math.min(1, Math.max(0, atlas.confidence)))];
    band.n += 1;
    if (top.country === photo.country) band.right += 1;
  }
  return bands;
}

/** Bands laid out on SURENESS_EDGES (counted here, or by `sureness_bands` in calibration.py). */
function onEdges(bands: readonly SurenessBand[]): boolean {
  return (
    bands.length === SURENESS_EDGES.length - 1 &&
    bands.every((b, i) => b.lo === SURENESS_EDGES[i] && b.hi === SURENESS_EDGES[i + 1])
  );
}

/** The band a confidence falls in, if it has enough photos to say anything. */
export function bandFor(bands: readonly SurenessBand[], confidence: number): SurenessBand | null {
  if (!Number.isFinite(confidence) || !onEdges(bands)) return null;
  const band = bands[bandIndex(Math.min(1, Math.max(0, confidence)))];
  return band && band.n >= MIN_BAND_PHOTOS ? band : null;
}

/** "20–40%": a band's range as players read it. */
export function bandLabel(band: SurenessBand): string {
  return `${Math.round(band.lo * 100)}–${Math.round(band.hi * 100)}%`;
}

/**
 * The reveal's reality check, e.g. "When Atlas is 60–80% sure, it names the right country in
 * 41 of 56 photos." Null when the band has too few photos.
 */
export function surenessLine(bands: readonly SurenessBand[], confidence: number): string | null {
  const band = bandFor(bands, confidence);
  if (!band) return null;
  return `When Atlas is ${bandLabel(band)} sure, it names the right country in ${band.right} of ${band.n} photos.`;
}
