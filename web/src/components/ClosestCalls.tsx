"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  atlasKm,
  closestCalls,
  continentGameHref,
  verdict,
  type CallVerdict,
} from "@/lib/closestCalls";
import { continentOf } from "@/lib/continents";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { formatDistance } from "@/lib/geo";
import { placeholderUrl, thumbUrl } from "@/lib/photoSources";
import type { PlayedPhoto } from "@/lib/playedMap";
import { useUnits } from "@/lib/useUnits";

/** What the gallery needs from the deck: where records live, what it deals, its continents. */
export type ClosestCallsDeck = Pick<Deck, "version" | "ids" | "regions">;

/** A gallery card's photo width: one of Wikimedia's standard thumbnail sizes. */
export const CARD_WIDTH = 500;

/** A photo small enough for a gallery card, or the address itself when it has no thumbnails. */
export function cardImage(imageUrl: string): string {
  return placeholderUrl(imageUrl) ? thumbUrl(imageUrl, CARD_WIDTH) : imageUrl;
}

const VERDICT_TEXT: Record<CallVerdict, string> = {
  you: "You beat Atlas",
  atlas: "Atlas got closer",
  tie: "Dead heat",
};

interface Props {
  played: readonly PlayedPhoto[];
  deck: ClosestCallsDeck;
  /** For tests: load one photo's record without the network. Defaults to the static files. */
  loadRecord?: (id: string) => Promise<GameRecord>;
}

/** Each closest call's record, by photo id, or "failed" once it couldn't be had. */
type Loaded = Record<string, GameRecord | "failed">;

/**
 * Your closest calls: the five rounds on your map where your pin landed nearest, each with its
 * photo, your distance, Atlas's on the same photo and a link to a game on that continent.
 * Records are fetched one by one, so a photo the site has dropped (or a failed request) only
 * costs that card its photo and Atlas line, never the gallery.
 */
export default function ClosestCalls({ played, deck, loadRecord }: Props) {
  const units = useUnits();
  const calls = useMemo(() => closestCalls(played), [played]);
  const [loaded, setLoaded] = useState<Loaded>({});

  const wanted = useMemo(() => {
    const dealt = new Set(deck.ids);
    return calls.map((c) => c.id).filter((id) => dealt.has(id));
  }, [calls, deck.ids]);

  useEffect(() => {
    let cancelled = false;
    const load =
      loadRecord ?? ((id: string) => fetchRecords(deck, [id]).then(([record]) => record));
    for (const id of wanted) {
      load(id)
        .then(
          (record): GameRecord | "failed" => record,
          (): "failed" => "failed",
        )
        .then((record) => {
          if (!cancelled) setLoaded((prev) => ({ ...prev, [id]: record }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [wanted, deck, loadRecord]);

  if (calls.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="closest-calls">
      <h2 id="closest-calls" className="font-sign text-3xl font-extrabold">
        Your closest calls
      </h2>
      <p className="mt-1 text-sm text-chalk-dim">
        The {calls.length === 1 ? "round" : `${calls.length} rounds`} where your pin landed nearest,
        against Atlas on the same photo.
      </p>
      <ol
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="Your closest calls"
      >
        {calls.map((call, i) => {
          const got = loaded[call.id];
          const record = got && got !== "failed" && got.photo.id === call.id ? got : null;
          const photo = record?.photo ?? null;
          const atlas = atlasKm(call, record);
          const yours = call.km!;
          const who = atlas === null ? null : verdict(yours, atlas);
          const href = continentGameHref(call, deck.regions);
          const continent = continentOf(call.country);
          return (
            <li
              key={call.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-graticule bg-ocean-deep"
              data-testid="closest-call"
            >
              <div className="relative aspect-[4/3] bg-graticule/40">
                {photo && (
                  // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cardImage(photo.imageUrl)}
                    alt={`Your photo from ${call.place}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
                <span className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-2 py-0.5 font-sign text-sm font-extrabold">
                  #{i + 1}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
                <p className="line-clamp-2 font-semibold leading-snug" title={call.place}>
                  {call.place}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 tabular-nums">
                  <dt className="text-chalk-dim">You</dt>
                  <dd className="text-right font-semibold text-gold">
                    {formatDistance(yours, units)}
                  </dd>
                  {record && (
                    <>
                      <dt className="text-chalk-dim">Atlas</dt>
                      <dd className="text-right">
                        {atlas === null ? "No guess" : formatDistance(atlas, units)}
                      </dd>
                    </>
                  )}
                </dl>
                {who && (
                  <p
                    className={`text-xs font-semibold ${who === "you" ? "text-gold" : "text-chalk-dim"}`}
                  >
                    {VERDICT_TEXT[who]}
                  </p>
                )}
                {photo && (
                  <p className="truncate text-[11px] text-chalk-dim">
                    <a
                      href={photo.credit.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {photo.credit.author}
                    </a>
                    , {photo.credit.license}
                  </p>
                )}
                {href && continent && (
                  <Link
                    href={href}
                    className="mt-auto pt-2 font-semibold text-sonar underline-offset-2 hover:underline"
                  >
                    Play {continent} →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
