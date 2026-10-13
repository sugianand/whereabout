// Country names for ISO 3166-1 alpha-2 codes, from the browser's own region names (Intl), so the
// game ships no name table. Unknown codes fall back to the code itself.

let regions: Intl.DisplayNames | null | undefined;

export function countryName(code: string): string {
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
    } catch {
      regions = null;
    }
  }
  if (!regions || !/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export type CountryChance = { country: string; p: number };

/**
 * Atlas's shortlist as the reveal shows it: the most likely countries in order, dropping any it
 * gave under `minP` (a 0% entry tells the player nothing) but always keeping its first choice.
 */
export function shortlist(top: CountryChance[], max = 5, minP = 0.01): CountryChance[] {
  const ranked = [...top].sort((a, b) => b.p - a.p);
  return ranked.filter((c, i) => i === 0 || c.p >= minP).slice(0, max);
}
