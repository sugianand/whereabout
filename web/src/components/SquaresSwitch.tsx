"use client";

import { SQUARE_SETS, SQUARE_SETS_ORDER, SQUARE_SET_NAME, setSquares } from "@/lib/squares";
import { useSquares } from "@/lib/useSquares";

/**
 * A two-way switch for the squares a text share sends: classic (🟩 first) or colour-blind safe
 * (🟦 first). The choice is kept in this browser and every share and preview follows it.
 */
export default function SquaresSwitch({ className = "" }: { className?: string }) {
  const set = useSquares();
  return (
    <div
      role="group"
      aria-label="Share squares"
      className={`inline-flex shrink-0 overflow-hidden rounded-full border border-chalk/30 text-xs ${className}`}
    >
      {SQUARE_SETS_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={set === s}
          title={`Share in ${SQUARE_SET_NAME[s].toLowerCase()} squares`}
          onClick={() => setSquares(s)}
          className={`min-h-6 px-2.5 font-semibold transition ${
            set === s ? "bg-chalk text-ocean-deep" : "text-chalk-dim hover:text-chalk"
          }`}
        >
          <span aria-hidden="true">{SQUARE_SETS[s][0]} </span>
          {SQUARE_SET_NAME[s]}
        </button>
      ))}
    </div>
  );
}
