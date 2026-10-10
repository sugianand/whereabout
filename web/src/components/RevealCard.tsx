"use client";

import { useEffect, useRef } from "react";

import type { RoundResult } from "@/lib/game/state";
import { formatDistance, formatPoints } from "@/lib/geo";
import { REVEAL_DRAW_MS } from "@/lib/reveal";
import { useCountUp } from "@/lib/useCountUp";

import AtlasEyes from "./AtlasEyes";

type RevealCardProps = {
  result: RoundResult;
  isLast: boolean;
  onNext: () => void;
};

function ScoreLine({
  who,
  tone,
  distanceKm,
  score,
}: {
  who: string;
  tone: "flare" | "sonar";
  distanceKm: number;
  score: number;
}) {
  // Numbers start counting as the arcs land on the truth.
  const km = useCountUp(distanceKm, 900, REVEAL_DRAW_MS - 200);
  const pts = useCountUp(score, 900, REVEAL_DRAW_MS - 200);
  const color = tone === "flare" ? "text-flare" : "text-sonar";
  return (
    <div className="flex items-baseline gap-3">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 -translate-y-0.5 rounded-full ${tone === "flare" ? "bg-flare" : "bg-sonar"}`}
      />
      <span className="w-14 text-chalk-dim">{who}</span>
      <span className={`font-sign tabular text-3xl font-bold ${color}`}>{formatDistance(km)}</span>
      <span className="ml-auto tabular text-chalk-dim">{formatPoints(pts)} points</span>
    </div>
  );
}

export function verdict(result: RoundResult): string | null {
  const { reveal, atlas } = result;
  if (!atlas) return null;
  if (reveal.score > atlas.score) return "You beat Atlas on this one.";
  if (reveal.score === atlas.score) return "A dead heat with Atlas.";
  return "Atlas got closer this time.";
}

export default function RevealCard({ result, isLast, onNext }: RevealCardProps) {
  const { reveal, atlas } = result;
  const credit = reveal.answer.credit;
  const nextRef = useRef<HTMLButtonElement>(null);
  const said = verdict(result);

  // Move focus to the next action so keyboard players can press Enter to continue.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [result]);

  return (
    <section
      aria-labelledby="reveal-place"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-5 shadow-2xl md:p-6"
    >
      <p className="text-sm text-gold">It was taken in</p>
      <h2
        id="reveal-place"
        className="font-sign text-4xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {reveal.answer.place}
      </h2>

      {/* Announced once, in full, for screen readers; the animated numbers are hidden from them. */}
      <p className="sr-only" aria-live="polite">
        {`You were ${formatDistance(reveal.distanceKm)} away and scored ${formatPoints(reveal.score)} points.`}
        {atlas
          ? ` Atlas was ${formatDistance(atlas.distanceKm)} away and scored ${formatPoints(atlas.score)}.`
          : ""}
        {said ? ` ${said}` : ""}
      </p>

      <div className="mt-5 space-y-2" aria-hidden="true">
        <ScoreLine who="You" tone="flare" distanceKm={reveal.distanceKm} score={reveal.score} />
        {atlas && (
          <ScoreLine who="Atlas" tone="sonar" distanceKm={atlas.distanceKm} score={atlas.score} />
        )}
      </div>

      {atlas?.guessedPlace && (
        <p className="mt-3 text-sm text-chalk-dim">
          Atlas guessed <span className="text-sonar">{atlas.guessedPlace}</span>,{" "}
          {Math.round(atlas.confidence * 100)}% sure of the country.
        </p>
      )}

      {atlas && (atlas.clues.length > 0 || atlas.looked) && (
        <div className="mt-4 flex items-start gap-4">
          {atlas.looked && (
            <figure className="w-24 shrink-0">
              <AtlasEyes src={result.round.photo.imageUrl} looked={atlas.looked} />
              <figcaption className="mt-1 text-xs leading-tight text-chalk-dim">
                Where Atlas looked
              </figcaption>
            </figure>
          )}
          {atlas.clues.length > 0 && (
            <div className="min-w-0">
              <p className="text-sm text-chalk-dim">What Atlas noticed</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {atlas.clues.slice(0, 4).map((clue) => (
                  <li
                    key={clue.label}
                    className="rounded-full border border-sonar/40 px-3 py-1 text-sm text-sonar"
                  >
                    {clue.label}{" "}
                    <span className="tabular text-chalk-dim">{Math.round(clue.p * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {said && <p className="mt-4 text-chalk">{said}</p>}

      <div className="mt-5 flex items-center gap-4">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {isLast ? "See your results" : "Next photo"}
        </button>
        {credit && (
          <a
            href={credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
          >
            Photo: {credit.author}, {credit.license}
          </a>
        )}
      </div>
    </section>
  );
}
