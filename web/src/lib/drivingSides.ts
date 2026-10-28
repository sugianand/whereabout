/**
 * Which side of the road a country drives on, for the reveal's "real clues" (`trueClues.ts`).
 *
 * The same table as `LEFT_HAND_TRAFFIC` and `NO_ROAD_TRAFFIC` in ml/src/whereabout_ml/labels.py,
 * which labels the photos' own driving side; `drivingSides.test.ts` reads that file and fails if
 * the two drift apart. Source: the list of left-hand traffic jurisdictions in "Left- and
 * right-hand traffic" (Wikipedia, CC BY-SA 4.0).
 */

export type DrivingSide = "left" | "right";

export const LEFT_HAND_TRAFFIC: ReadonlySet<string> = new Set(
  `AG AI AU BB BD BM BN BS BT BW CC CK CX CY DM FJ FK GB GD GG GY HK ID IE IM IN JE JM JP KE
   KI KN KY LC LK LS MO MS MT MU MV MW MY MZ NA NF NP NR NU NZ PG PK PN SB SC SG SH SR SZ TC
   TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW`.split(/\s+/),
);

/** Uninhabited or research-station territories: no public road convention to learn from. */
export const NO_ROAD_TRAFFIC: ReadonlySet<string> = new Set([
  "AQ",
  "BV",
  "GS",
  "HM",
  "IO",
  "TF",
  "UM",
]);

/** The side traffic keeps to in `country` (ISO alpha-2), or null when there is none to know. */
export function drivingSideOf(country: string | null | undefined): DrivingSide | null {
  const code = country?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || NO_ROAD_TRAFFIC.has(code)) return null;
  return LEFT_HAND_TRAFFIC.has(code) ? "left" : "right";
}
