import { haversineKm, scoreDistance, type LngLat } from "@/lib/geo";

import type { CatalogPhoto, GameBackend, Reveal, RoundStart } from "./types";

/**
 * Plays rounds from a fixed list of photos entirely in the browser.
 *
 * Used by the static demo, where there is no server. It scores with the same formula as the
 * API, but the answers ship in the page, so it trades anti-cheat for zero hosting cost
 * (docs/decisions/0002-static-demo-mode.md).
 */
export class LocalBackend implements GameBackend {
  readonly kind = "local" as const;
  private next = 0;
  private readonly open = new Map<string, CatalogPhoto>();

  constructor(private readonly photos: readonly CatalogPhoto[]) {
    if (photos.length === 0) throw new Error("LocalBackend needs at least one photo");
  }

  async startRound(): Promise<RoundStart> {
    const photo = this.photos[this.next % this.photos.length];
    this.next += 1;
    const roundId = `${photo.id}:${this.next}`;
    this.open.set(roundId, photo);
    return { roundId, photo: { id: photo.id, imageUrl: photo.imageUrl } };
  }

  async guess(roundId: string, at: LngLat): Promise<Reveal> {
    const photo = this.open.get(roundId);
    if (!photo) throw new Error("This round has already been guessed or does not exist.");
    this.open.delete(roundId);
    const distanceKm = haversineKm(at, photo);
    return {
      roundId,
      distanceKm,
      score: scoreDistance(distanceKm),
      answer: {
        lng: photo.lng,
        lat: photo.lat,
        place: photo.place,
        country: photo.country,
        credit: photo.credit,
      },
    };
  }
}

interface ApiRound {
  round_id: string;
  photo: { id: string; image_url: string };
}

interface ApiGuess {
  round_id: string;
  distance_km: number;
  score: number;
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
}

/** Talks to the FastAPI backend, which keeps answers server-side until the guess. */
export class ApiBackend implements GameBackend {
  readonly kind = "api" as const;

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
    };
  }

  async guess(roundId: string, at: LngLat): Promise<Reveal> {
    const g = await this.post<ApiGuess>(`/api/v1/rounds/${encodeURIComponent(roundId)}/guess`, {
      lat: at.lat,
      lon: at.lng,
    });
    const c = g.answer.credit;
    return {
      roundId: g.round_id,
      distanceKm: g.distance_km,
      score: g.score,
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
    };
  }
}
