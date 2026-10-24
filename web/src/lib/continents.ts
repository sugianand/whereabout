/**
 * ISO 3166-1 alpha-2 country code → continent, for grouping Atlas's results.
 * Seven-continent model; transcontinental countries go where most of their people live
 * (Russia, Turkey, Kazakhstan, Georgia, Armenia, Azerbaijan, Cyprus and Egypt as listed below).
 */
export const CONTINENTS = [
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Oceania",
  "Antarctica",
] as const;

export type Continent = (typeof CONTINENTS)[number];

const BY_CONTINENT: Record<Continent, string> = {
  Africa:
    "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  Asia: "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE",
  Europe:
    "AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA",
  "North America":
    "AI AG AW BS BB BZ BM BQ CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VG VI",
  "South America": "AR BO BR CL CO EC FK GF GY PY PE SR UY VE",
  Oceania: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF",
  Antarctica: "AQ BV GS HM TF",
};

const LOOKUP: ReadonlyMap<string, Continent> = new Map(
  CONTINENTS.flatMap((c) => BY_CONTINENT[c].split(" ").map((code) => [code, c] as const)),
);

/** The continent of a country code, or null for an unknown code. */
export function continentOf(country: string | null | undefined): Continent | null {
  return country ? (LOOKUP.get(country.toUpperCase()) ?? null) : null;
}

/** Every country code with its continent (the API keeps the same table; see hints.test.ts). */
export const CONTINENT_OF: ReadonlyMap<string, Continent> = LOOKUP;
