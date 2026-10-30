import { describe, expect, it } from "vitest";

import type { RoundResult } from "@/lib/game/state";
import { formatDistance, scoreDistance } from "@/lib/geo";

import { atlasLine, surePercent } from "./atlasVoice";

type Opts = {
  playerKm: number | null;
  playerScore?: number;
  atlasKm: number;
  atlasScore?: number;
  confidence?: number;
  top?: string | null;
  truth?: string | null;
  hints?: number;
  id?: string;
};

function round(o: Opts): RoundResult {
  const top = o.top === undefined ? "JP" : o.top;
  return {
    round: {
      roundId: "r1",
      photo: { id: o.id ?? "p1", imageUrl: "https://example.org/p.jpg" },
      hintsAvailable: 3,
    },
    pin: o.playerKm === null ? null : { lng: 0, lat: 0 },
    clues: [],
    reveal: {
      roundId: "r1",
      distanceKm: o.playerKm,
      score: o.playerScore ?? (o.playerKm === null ? 0 : scoreDistance(o.playerKm)),
      hintsUsed: o.hints ?? 0,
      answer: {
        lng: 0,
        lat: 0,
        place: "Somewhere",
        country: o.truth === undefined ? "JP" : o.truth,
        credit: null,
      },
    },
    atlas: {
      lng: 0,
      lat: 0,
      confidence: o.confidence ?? 0.84,
      topCountries: top ? [{ country: top, p: o.confidence ?? 0.84 }] : [],
      clues: [],
      distanceKm: o.atlasKm,
      score: o.atlasScore ?? scoreDistance(o.atlasKm),
    },
  };
}

describe("atlasLine", () => {
  it("says nothing when Atlas sat the photo out", () => {
    expect(atlasLine({ ...round({ playerKm: 10, atlasKm: 20 }), atlas: null }, "km")).toBeNull();
  });

  it("is sure and right, and wins by the real margin", () => {
    const r = round({ playerKm: 2400, atlasKm: 120 });
    expect(atlasLine(r, "km", 0)).toBe(
      "I was 84% sure it was Japan, and it was. I beat you by 2,280 km.",
    );
    expect(atlasLine(r, "km", 3)).toBe(
      "Japan, 84% sure. Right country. I was 2,280 km closer than you.",
    );
  });

  it("names the real country when it was sure and wrong, and concedes to a better pin", () => {
    const r = round({ playerKm: 300, atlasKm: 900, top: "FR", truth: "BE", confidence: 0.81 });
    expect(atlasLine(r, "km", 0)).toBe(
      "I was 81% sure of France. It was Belgium. You beat me by 600 km. Well played.",
    );
    expect(atlasLine(r, "km", 3)).toBe(
      "81% on France, and it wasn't. That stings. You were 600 km closer. I'll remember that.",
    );
  });

  it("leans or calls it a hunch below the sure bar", () => {
    expect(atlasLine(round({ playerKm: 900, atlasKm: 100, confidence: 0.45 }), "km", 0)).toBe(
      "I leaned Japan at 45%, and it was. I beat you by 800 km.",
    );
    expect(atlasLine(round({ playerKm: 900, atlasKm: 100, confidence: 0.22 }), "km", 0)).toBe(
      "Japan was only a 22% hunch, but it was the right country. I beat you by 800 km.",
    );
    expect(
      atlasLine(
        round({ playerKm: 900, atlasKm: 2000, confidence: 0.12, top: "PE", truth: "CL" }),
        "km",
        0,
      ),
    ).toBe("I was lost: Peru at just 12%. It was Chile. You beat me by 1,100 km. Well played.");
  });

  it("calls a margin under 50 km a near thing, either way", () => {
    expect(atlasLine(round({ playerKm: 130, atlasKm: 118 }), "km", 0)).toBe(
      "I was 84% sure it was Japan, and it was. I beat you by just 12 km.",
    );
    expect(atlasLine(round({ playerKm: 118, atlasKm: 130 }), "km", 0)).toBe(
      "I was 84% sure it was Japan, and it was. You edged me by 12 km.",
    );
  });

  it("puts a closer pin's loss down to the hints that capped it", () => {
    const r = round({ playerKm: 50, playerScore: 3000, atlasKm: 400, hints: 2 });
    expect(atlasLine(r, "km", 0)).toBe(
      "I was 84% sure it was Japan, and it was. You were 350 km closer, but your hints cost you: I take it on points.",
    );
  });

  it("takes a round with no pin, and calls a tie a tie", () => {
    expect(atlasLine(round({ playerKm: null, atlasKm: 340 }), "km", 0)).toBe(
      "I was 84% sure it was Japan, and it was. No pin from you, so I take it from 340 km away.",
    );
    expect(
      atlasLine(round({ playerKm: 15000, atlasKm: 18000, playerScore: 0, atlasScore: 0 }), "km", 0),
    ).toBe("I was 84% sure it was Japan, and it was. Neither of us scored a point.");
    expect(
      atlasLine(
        round({ playerKm: 0.2, atlasKm: 0.4, playerScore: 5000, atlasScore: 5000 }),
        "km",
        0,
      ),
    ).toBe(
      "I was 84% sure it was Japan, and it was. Same points for us both, 200 m and 400 m out.",
    );
  });

  it("speaks in the player's units", () => {
    expect(atlasLine(round({ playerKm: 2400, atlasKm: 120 }), "mi", 0)).toBe(
      "I was 84% sure it was Japan, and it was. I beat you by 1,417 mi.",
    );
  });

  it("drops the country half when Atlas named no country", () => {
    expect(atlasLine(round({ playerKm: 2400, atlasKm: 120, top: null }), "km", 0)).toBe(
      "I beat you by 2,280 km.",
    );
  });

  it("reads the same for the same photo, from its id", () => {
    const r = round({ playerKm: 2400, atlasKm: 120, id: "wm042" });
    expect(atlasLine(r, "km")).toBe(atlasLine(r, "km"));
    expect(atlasLine(r, "km")).toBe(atlasLine({ ...r }, "km"));
  });

  it("only ever states the round's own numbers", () => {
    // Every number in every phrasing is the sureness, a distance or the margin from this round.
    let state = 7;
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    const codes = ["JP", "FR", "BR", "KE", "AU"];
    for (let i = 0; i < 400; i++) {
      const playerKm = rand() < 0.1 ? null : Math.round(rand() * 20000 * 10) / 10;
      const atlasKm = Math.round(rand() * 20000 * 10) / 10;
      const hints = rand() < 0.3 ? Math.floor(rand() * 3) + 1 : 0;
      const raw = playerKm === null ? 0 : scoreDistance(playerKm);
      const playerScore = Math.min(raw, 5000 - hints * 1000);
      const confidence = Math.round(rand() * 1000) / 1000;
      const top = codes[Math.floor(rand() * codes.length)];
      const truth = rand() < 0.5 ? top : codes[Math.floor(rand() * codes.length)];
      for (const units of ["km", "mi"] as const) {
        const r = round({ playerKm, playerScore, atlasKm, hints, confidence, top, truth });
        const allowed = new Set<string>([`${surePercent(confidence)}%`]);
        const add = (km: number) => allowed.add(formatDistance(km, units));
        add(atlasKm);
        if (playerKm !== null) {
          add(playerKm);
          add(Math.abs(playerKm - atlasKm));
        }
        for (let pick = 0; pick < 4; pick++) {
          const line = atlasLine(r, units, pick)!;
          const numbers = line.match(/\d[\d,.]*\s?(?:%|km|mi|m|ft)/g) ?? [];
          expect(numbers.length).toBeGreaterThan(0);
          for (const n of numbers) expect(allowed, line).toContain(n);
          // Points decide the outcome, as they do on the card.
          if (playerKm !== null && r.atlas!.score > playerScore)
            expect(line).toMatch(/I beat you|I was .+ closer|I take it on points/);
          if (playerKm !== null && r.atlas!.score < playerScore)
            expect(line).toMatch(/You beat me|You edged me|You were .+ closer\. I'll/);
        }
      }
    }
  });
});
