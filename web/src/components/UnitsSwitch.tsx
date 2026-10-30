"use client";

import { setUnits, unitsName, type Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

const CHOICES: readonly Units[] = ["km", "mi"];

/**
 * A two-way "km | mi" switch for every distance on the page. The choice is remembered in this
 * browser and every distance on screen follows it at once (`useUnits`).
 */
export default function UnitsSwitch({ className = "" }: { className?: string }) {
  const units = useUnits();
  return (
    <div
      role="group"
      aria-label="Distances in"
      className={`inline-flex shrink-0 overflow-hidden rounded-full border border-chalk/30 text-xs ${className}`}
    >
      {CHOICES.map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={units === u}
          aria-label={unitsName(u)}
          title={`Show distances in ${unitsName(u)}`}
          onClick={() => setUnits(u)}
          className={`min-h-6 px-2.5 font-semibold transition ${
            units === u ? "bg-chalk text-ocean-deep" : "text-chalk-dim hover:text-chalk"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
