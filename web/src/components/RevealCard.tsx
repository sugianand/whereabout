"use client";

import { useEffect, useId, useRef, useState } from "react";

import { countryName, shortlist } from "@/lib/countries";
import type { RoundResult } from "@/lib/game/state";
import { surenessLine, type SurenessBand } from "@/lib/game/sureness";
import { formatDistance, formatPoints, maxPoints } from "@/lib/geo";
import { REVEAL_DRAW_MS } from "@/lib/reveal";
import { trueClues, type TrueClue } from "@/lib/trueClues";
import { useCountUp } from "@/lib/useCountUp";

import AtlasEyes from "./AtlasEyes";

type RevealCardProps = {
  result: RoundResult;
  isLast: boolean;
  onNext: () => void;
  /** How often Atlas is right at each confidence, from the shipped photos (`sureness.ts`). */
  sureness?: readonly SurenessBand[];
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

function RealClue({ clue, atlasPlayed }: { clue: TrueClue; atlasPlayed: boolean }) {
  const mark = clue.right === true ? "✓" : clue.right === false ? "✗" : null;
  const said =
    clue.right === true
      ? "Atlas read it right"
      : clue.right === false
        ? "Atlas read it wrong"
        : null;
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-2"
      data-testid="real-clue"
      data-right={String(clue.right)}
    >
      <span className="text-gold">{clue.truth}</span>
      {atlasPlayed && (
        <span
          className={
            clue.right === true
              ? "text-sonar"
              : clue.right === false
                ? "text-flare"
                : "text-chalk-dim"
          }
        >
          {mark && <span aria-hidden="true">{mark} </span>}
          {said && <span className="sr-only">{said}: </span>}
          {clue.atlas ? `Atlas: ${clue.atlas}` : "Atlas didn’t say"}
        </span>
      )}
    </li>
  );
}

export function verdict(result: RoundResult): string | null {
  const { reveal, atlas } = result;
  if (!atlas) return null;
  if (reveal.score > atlas.score) return "You beat Atlas on this one.";
  if (reveal.score === atlas.score) return "A dead heat with Atlas.";
  return "Atlas got closer this time.";
}

/** "You took 2 hints, so this round was worth up to 3,000 points.", or null without hints. */
export function hintNote(result: RoundResult): string | null {
  const used = result.reveal.hintsUsed;
  if (!used) return null;
  return `You took ${used} hint${used === 1 ? "" : "s"}, so this round was worth up to ${formatPoints(maxPoints(used))} points.`;
}

export default function RevealCard({ result, isLast, onNext, sureness }: RevealCardProps) {
  const { reveal, atlas } = result;
  const credit = reveal.answer.credit;
  const nextRef = useRef<HTMLButtonElement>(null);
  const said = verdict(result);
  const hinted = hintNote(result);
  const shortlisted = atlas ? shortlist(atlas.topCountries ?? []) : [];
  const truthCountry = reveal.answer.country;
  const truthListed = shortlisted.some((c) => c.country === truthCountry);
  const realityCheck = atlas && sureness ? surenessLine(sureness, atlas.confidence) : null;
  const realClues = trueClues(reveal.answer.clues, atlas);
  const hasThinking =
    realClues.length > 0 ||
    (!!atlas &&
      (!!atlas.guessedPlace || shortlisted.length > 1 || atlas.clues.length > 0 || !!atlas.looked));
  // On phones Atlas's reasoning folds away so the globe behind the card stays in view; wider
  // screens have room for it and always show it.
  // The fold remembers which round it was opened for, so a new round starts folded.
  const [openFor, setOpenFor] = useState<RoundResult | null>(null);
  const thinkingOpen = openFor === result;
  const thinkingId = useId();

  // Move focus to the next action so keyboard players can press Enter to continue.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [result]);

  return (
    <section
      aria-labelledby="reveal-place"
      className="wb-card pointer-events-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <p className="text-sm text-gold">It was taken in</p>
      <h2
        id="reveal-place"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
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
        {hinted ? ` ${hinted}` : ""}
      </p>

      <div className="mt-3 space-y-1 md:mt-5 md:space-y-2" aria-hidden="true">
        <ScoreLine who="You" tone="flare" distanceKm={reveal.distanceKm} score={reveal.score} />
        {atlas && (
          <ScoreLine who="Atlas" tone="sonar" distanceKm={atlas.distanceKm} score={atlas.score} />
        )}
      </div>

      {hinted && (
        <p className="mt-1 text-xs text-chalk-dim" aria-hidden="true">
          {hinted}
        </p>
      )}

      {said && <p className="mt-3 text-chalk">{said}</p>}

      {hasThinking && (
        <button
          type="button"
          aria-expanded={thinkingOpen}
          aria-controls={thinkingId}
          onClick={() => setOpenFor(thinkingOpen ? null : result)}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sonar md:hidden"
        >
          {atlas
            ? thinkingOpen
              ? "Hide how Atlas guessed"
              : "How Atlas guessed"
            : thinkingOpen
              ? "Hide the real clues"
              : "The real clues"}
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`size-3 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </button>
      )}

      <div
        id={thinkingId}
        data-testid="atlas-thinking"
        className={thinkingOpen ? "" : "hidden md:block"}
      >
        {atlas?.guessedPlace && (
          <p className="mt-3 text-sm text-chalk-dim">
            Atlas guessed <span className="text-sonar">{atlas.guessedPlace}</span>,{" "}
            {Math.round(atlas.confidence * 100)}% sure of the country.
            {realityCheck && <span data-testid="atlas-sureness"> {realityCheck}</span>}
          </p>
        )}

        {atlas && shortlisted.length > 1 && (
          <div className="mt-2 text-sm">
            <p className="text-chalk-dim" id="atlas-shortlist">
              Atlas&apos;s shortlist
              {truthCountry && !truthListed ? (
                <span> ({countryName(truthCountry)} wasn&apos;t on it)</span>
              ) : null}
            </p>
            <ol aria-labelledby="atlas-shortlist" className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {shortlisted.map((c, i) => {
                const right = c.country === truthCountry;
                // Phones keep the card short: the fourth and fifth choices show on wider screens.
                const narrow = i >= 3 && !right ? "hidden md:list-item" : "";
                return (
                  <li
                    key={c.country}
                    className={`${right ? "text-gold" : "text-chalk"} ${narrow}`.trim()}
                  >
                    {countryName(c.country)}{" "}
                    <span className={`tabular ${right ? "" : "text-chalk-dim"}`}>
                      {Math.max(1, Math.round(c.p * 100))}%
                    </span>
                    {right && <span className="sr-only"> (the right country)</span>}
                  </li>
                );
              })}
            </ol>
          </div>
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

        {realClues.length > 0 && (
          <div className="mt-4 text-sm" data-testid="real-clues">
            <p className="text-chalk-dim" id={`${thinkingId}-real`}>
              The real clues{atlas ? ", and what Atlas read" : ""}
            </p>
            <ul aria-labelledby={`${thinkingId}-real`} className="mt-1 space-y-1">
              {realClues.map((clue) => (
                <RealClue key={clue.kind} clue={clue} atlasPlayed={!!atlas} />
              ))}
            </ul>
            <p className="mt-1 text-xs text-chalk-dim">
              From maps of the spot: Köppen-Geiger climate (Beck et al. 2023) and ESA WorldCover
              2021, both CC BY 4.0.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-4 md:mt-5">
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
