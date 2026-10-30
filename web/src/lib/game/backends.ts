import { haversineKm, scoreDistance, type LngLat } from "@/lib/geo";
import { cluesFor, type Clue } from "@/lib/hints";

import type { AtlasGuess, CatalogPhoto, GameBackend, Reveal, RoundStart } from "./types";

/**
 * Plays rounds from a fixed list of photos entirely in the browser.
 *
 * Used by the static demo, where there is no server. It scores with the same formula as the
 * API, but the answers ship in the page, so it trades anti-cheat for zero hosting cost
 * (docs/decisions/0002-static-demo-mode.md).
 */
export class LocalBackend implements GameBackend {
  readonly kind = "local" as const;
  private next: number;
  private readonly open = new Map<string, { photo: CatalogPhoto; clues: Clue[]; used: number }>();

  /** `firstRound` skips rounds already played, for a game picked up after a reload. */
  constructor(
    private readonly photos: readonly CatalogPhoto[],
    firstRound = 0,
  ) {
    if (photos.length === 0) throw new Error("LocalBackend needs at least one photo");
    this.next = firstRound;
  }

  async startRound(): Promise<RoundStart> {
    const photo = this.photos[this.next % this.photos.length];
    this.next += 1;
    const roundId = `${photo.id}:${this.next}`;
    const clues = cluesFor(photo);
    this.open.set(roundId, { photo, clues, used: 0 });
    return {
      roundId,
      photo: { id: photo.id, imageUrl: photo.imageUrl },
      hintsAvailable: clues.length,
    };
  }

  async hint(roundId: string): Promise<Clue[]> {
    const round = this.open.get(roundId);
    if (!round) throw new Error("This round has already been guessed or does not exist.");
    if (round.used >= round.clues.length) throw new Error("No hints left for this photo.");
    round.used += 1;
    return round.clues.slice(0, round.used);
  }

  async guess(roundId: string, at: LngLat | null): Promise<Reveal> {
    const round = this.open.get(roundId);
    if (!round) throw new Error("This round has already been guessed or does not exist.");
    this.open.delete(roundId);
    const { photo, used } = round;
    // No pin when a Blitz clock ran out: the answer is shown, the round scores nothing.
    const distanceKm = at ? haversineKm(at, photo) : null;
    return {
      roundId,
      distanceKm,
      score: distanceKm === null ? 0 : scoreDistance(distanceKm, used),
      hintsUsed: used,
      answer: {
        lng: photo.lng,
        lat: photo.lat,
        place: photo.place,
        country: photo.country,
        credit: photo.credit,
        clues: {
          ...(photo.drivingSide ? { drivingSide: photo.drivingSide } : {}),
          ...(photo.climateGroup ? { climateGroup: photo.climateGroup } : {}),
          ...(photo.landCover ? { landCover: photo.landCover } : {}),
        },
        ...(photo.postcard ? { postcard: photo.postcard } : {}),
      },
    };
  }
}

interface ApiRound {
  round_id: string;
  photo: { id: string; image_url: string };
  /** Absent from servers older than hints. */
  hints_available?: number;
}

interface ApiHints {
  round_id: string;
  hints: Clue[];
  hints_left: number;
  max_score: number;
}

interface ApiGuess {
  round_id: string;
  distance_km: number;
  score: number;
  hints_used?: number;
  answer: {
    lat: number;
    lon: number;
    place_name: string;
    country: string | null;
    credit: {
      author: string | null;
      license: string | null;
      source_url: string | null;
    };
  };
  atlas?: {
    lat: number;
    lon: number;
    guessed_place: string | null;
    confidence: number;
    top_countries: { country: string; p: number }[];
    clues: { label: string; p: number }[];
    belief?: Record<string, number> | null;
    distance_km: number;
    score: number;
  } | null;
}

function atlasFromApi(a: ApiGuess["atlas"]): AtlasGuess | null | undefined {
  if (a === undefined) return undefined; // an older server: let the client decide
  if (a === null) return null;
  return {
    lng: a.lon,
    lat: a.lat,
    confidence: a.confidence,
    ...(a.guessed_place ? { guessedPlace: a.guessed_place } : {}),
    topCountries: a.top_countries,
    ...(a.belief ? { belief: a.belief } : {}),
    clues: a.clues,
  };
}

/** Talks to the FastAPI backend, which keeps answers server-side until the guess. */
export class ApiBackend implements GameBackend {
  readonly kind = "api" as const;
  /** Hints taken per round, sent with the guess so the server can check its own count. */
  private readonly hintsTaken = new Map<string, number>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async post<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("Couldn't reach the game server. Check your connection and try again.");
    }
    if (!res.ok) throw new Error(`The game server answered ${res.status}. Try again.`);
    return (await res.json()) as T;
  }

  async startRound(): Promise<RoundStart> {
    const r = await this.post<ApiRound>("/api/v1/rounds");
    return {
      roundId: r.round_id,
      photo: { id: r.photo.id, imageUrl: r.photo.image_url },
      hintsAvailable: r.hints_available ?? 0,
    };
  }

  async hint(roundId: string): Promise<Clue[]> {
    const h = await this.post<ApiHints>(`/api/v1/rounds/${encodeURIComponent(roundId)}/hints`);
    this.hintsTaken.set(roundId, h.hints.length);
    return h.hints.map(({ kind, text }) => ({ kind, text }));
  }

  async guess(roundId: string, at: LngLat | null): Promise<Reveal> {
    // The server scores a pin; Blitz, the one way to reach here without one, is browser-only.
    if (!at) throw new Error("Place your pin on the globe first.");
    const g = await this.post<ApiGuess>(`/api/v1/rounds/${encodeURIComponent(roundId)}/guess`, {
      lat: at.lat,
      lon: at.lng,
      hints_used: this.hintsTaken.get(roundId) ?? 0,
    });
    this.hintsTaken.delete(roundId);
    const c = g.answer.credit;
    return {
      roundId: g.round_id,
      distanceKm: g.distance_km,
      score: g.score,
      hintsUsed: g.hints_used ?? 0,
      answer: {
        lng: g.answer.lon,
        lat: g.answer.lat,
        place: g.answer.place_name,
        country: g.answer.country,
        credit:
          c.author && c.license && c.source_url
            ? { author: c.author, license: c.license, sourceUrl: c.source_url }
            : null,
      },
      ...(g.atlas === undefined ? {} : { atlas: atlasFromApi(g.atlas) }),
    };
  }
}
