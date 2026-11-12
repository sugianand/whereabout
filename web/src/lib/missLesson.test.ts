import { describe, expect, it } from "vitest";

import catalog from "@/data/photos.json";
import { continentOf } from "@/lib/continents";
import { tappableCountries } from "@/lib/countryHit";
import { drivingSideOf } from "@/lib/drivingSides";
import type { RoundResult } from "@/lib/game/state";

import { countryInSentence, MISS_LESSON_MIN_KM, missLesson, missLessonFor } from "./missLesson";

describe("missLesson", () => {
  const far = MISS_LESSON_MIN_KM + 1;

  it("names the driving side first when the two countries keep to different sides", () => {
    expect(
      missLesson({
        truthCountry: "JP",
        pinnedCountry: "BR",
        distanceKm: 18_000,
        truthSide: "left",
      }),
    ).toEqual({
      kind: "driving_side",
      text: "In Japan they drive on the left; in Brazil, where your pin landed, on the right.",
      short: "Japan drives on the left, Brazil on the right.",
    });
  });

  it("falls back to the continent when both drive on the same side", () => {
    expect(
      missLesson({ truthCountry: "FR", pinnedCountry: "US", distanceKm: 6000, truthSide: "right" }),
    ).toEqual({
      kind: "continent",
      text: "France is in Europe; the United States, where your pin landed, is in North America.",
      short: "France is in Europe, the United States in North America.",
    });
  });

  it("uses the continent when the reveal has no driving side for the photo", () => {
    expect(missLesson({ truthCountry: "JP", pinnedCountry: "BR", distanceKm: 18_000 })?.kind).toBe(
      "continent",
    );
    expect(
      missLesson({ truthCountry: "JP", pinnedCountry: "BR", distanceKm: 18_000, truthSide: null })
        ?.kind,
    ).toBe("continent");
  });

  it("uses the continent when the pinned country has no road convention", () => {
    expect(
      missLesson({ truthCountry: "AR", pinnedCountry: "AQ", distanceKm: far, truthSide: "right" }),
    ).toEqual({
      kind: "continent",
      text: "Argentina is in South America; your pin landed in Antarctica.",
      short: "Argentina is in South America, your pin in Antarctica.",
    });
  });

  it("says nothing when the two share every clue it knows", () => {
    // Same side of the road, same continent.
    expect(
      missLesson({ truthCountry: "ES", pinnedCountry: "RU", distanceKm: 4000, truthSide: "right" }),
    ).toBeNull();
    expect(
      missLesson({ truthCountry: "IN", pinnedCountry: "JP", distanceKm: 6000, truthSide: "left" }),
    ).toBeNull();
  });

  it("needs a miss further than the threshold", () => {
    const facts = { truthCountry: "GB", pinnedCountry: "FR", truthSide: "left" as const };
    expect(missLesson({ ...facts, distanceKm: MISS_LESSON_MIN_KM })).toBeNull();
    expect(missLesson({ ...facts, distanceKm: 300 })).toBeNull();
    expect(missLesson({ ...facts, distanceKm: null })).toBeNull();
    expect(missLesson({ ...facts, distanceKm: Number.NaN })).toBeNull();
    expect(missLesson({ ...facts, distanceKm: far })?.kind).toBe("driving_side");
  });

  it("needs two different, known countries", () => {
    const base = { distanceKm: far, truthSide: "left" as const };
    expect(missLesson({ ...base, truthCountry: "AU", pinnedCountry: "au" })).toBeNull();
    expect(missLesson({ ...base, truthCountry: "AU", pinnedCountry: null })).toBeNull();
    expect(missLesson({ ...base, truthCountry: null, pinnedCountry: "US" })).toBeNull();
    expect(missLesson({ ...base, truthCountry: "XX", pinnedCountry: "US" })).toBeNull();
    expect(missLesson({ ...base, truthCountry: "AU", pinnedCountry: "1" })).toBeNull();
  });
});

describe("countryInSentence", () => {
  it("gives the names that take one their article", () => {
    expect(countryInSentence("US")).toBe("the United States");
    expect(countryInSentence("gb")).toBe("the United Kingdom");
    expect(countryInSentence("AE")).toBe("the United Arab Emirates");
    expect(countryInSentence("DO")).toBe("the Dominican Republic");
    expect(countryInSentence("FO")).toBe("the Faroe Islands");
    expect(countryInSentence("NL")).toBe("the Netherlands");
    expect(countryInSentence("PH")).toBe("the Philippines");
    expect(countryInSentence("JP")).toBe("Japan");
    expect(countryInSentence("CZ")).toBe("Czechia");
  });

  it("starts a sentence with a capital", () => {
    expect(
      missLesson({ truthCountry: "US", pinnedCountry: "FR", distanceKm: 6000, truthSide: "right" })
        ?.text,
    ).toBe("The United States is in North America; France, where your pin landed, is in Europe.");
    expect(
      missLesson({ truthCountry: "GB", pinnedCountry: "BR", distanceKm: 9000, truthSide: "left" })
        ?.text,
    ).toBe(
      "In the United Kingdom they drive on the left; in Brazil, where your pin landed, on the right.",
    );
  });
});

describe("missLessonFor", () => {
  function round(
    pin: RoundResult["pin"],
    distanceKm: number | null,
    country: string,
    drivingSide?: "left" | "right",
  ): RoundResult {
    return {
      round: {
        roundId: "r",
        photo: { id: "p", imageUrl: "https://example.org/p.jpg" },
        hintsAvailable: 3,
      },
      pin,
      clues: [],
      reveal: {
        roundId: "r",
        distanceKm,
        score: 0,
        hintsUsed: 0,
        answer: {
          lng: 139.69,
          lat: 35.69,
          place: "Tokyo, Japan",
          country,
          credit: null,
          ...(drivingSide ? { clues: { drivingSide } } : {}),
        },
      },
      atlas: null,
    };
  }

  // A pin in Brazil, near Brasília.
  const brazil = { lng: -47.9, lat: -15.8 };

  it("reads the pinned country off the globe's own shapes", () => {
    expect(missLessonFor(round(brazil, 17_700, "JP", "left"))?.text).toBe(
      "In Japan they drive on the left; in Brazil, where your pin landed, on the right.",
    );
    expect(missLessonFor(round(brazil, 17_700, "JP"))?.kind).toBe("continent");
  });

  it("says nothing for a pin in the sea, no pin, or a near miss", () => {
    expect(missLessonFor(round({ lng: -30, lat: 0 }, 9000, "JP", "left"))).toBeNull();
    expect(missLessonFor(round(null, null, "JP", "left"))).toBeNull();
    expect(missLessonFor(round(brazil, 1500, "JP", "left"))).toBeNull();
  });

  it("says nothing when the pin is in the photo's own country", () => {
    expect(missLessonFor(round(brazil, 2500, "BR", "right"))).toBeNull();
  });
});

describe("missLesson against the whole catalog", () => {
  it("only ever says what the tables say, in names, for every photo and every country pinned", () => {
    const pinned = [...tappableCountries()];
    let lessons = 0;
    // Only a photo's country and driving side matter, so each pair of them is checked once.
    const kinds = new Map(catalog.map((p) => [`${p.country} ${p.drivingSide}`, p]));
    for (const photo of kinds.values()) {
      const side = photo.drivingSide;
      const truthSide = side === "left" || side === "right" ? side : null;
      for (const code of pinned) {
        const lesson = missLesson({
          truthCountry: photo.country,
          pinnedCountry: code,
          distanceKm: 10_000,
          truthSide,
        });
        if (!lesson) {
          // Silence only when the two share every clue (or are the same country).
          const sameSide = !truthSide || !drivingSideOf(code) || drivingSideOf(code) === truthSide;
          const sameContinent =
            !continentOf(code) || continentOf(code) === continentOf(photo.country);
          expect(code === photo.country || (sameSide && sameContinent)).toBe(true);
          continue;
        }
        lessons++;
        expect(lesson.text).not.toMatch(/\b[A-Z]{2}\b|undefined|null/);
        expect(lesson.short).not.toMatch(/\b[A-Z]{2}\b|undefined|null/);
        // The short form says the same clue in fewer words, starting with a capital.
        expect(lesson.short.length).toBeLessThan(lesson.text.length);
        expect(lesson.short).toMatch(/^[A-Z].*\.$/);
        if (lesson.kind === "driving_side") {
          expect(truthSide).not.toBeNull();
          expect(drivingSideOf(photo.country)).toBe(truthSide);
          expect(lesson.text).toContain(`on the ${drivingSideOf(code)}.`);
          expect(lesson.short).toContain(`drives on the ${truthSide}, `);
          expect(lesson.short).toContain(`on the ${drivingSideOf(code)}.`);
        } else {
          expect(lesson.text).toContain(`${continentOf(code)}.`);
          expect(lesson.text).toContain(`is in ${continentOf(photo.country)};`);
          expect(lesson.short).toContain(`is in ${continentOf(photo.country)}, `);
          expect(lesson.short).toContain(`${continentOf(code)}.`);
        }
      }
    }
    expect(lessons).toBeGreaterThan(0);
  });
});
