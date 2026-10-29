import { BLITZ_SECONDS, BLITZ_WARN_SECONDS } from "@/lib/game/blitz";

const R = 20;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Blitz's countdown: a ring that empties as the photo's time runs down, with the seconds left in
 * the middle. It turns flare-red for the last `BLITZ_WARN_SECONDS`. Screen readers hear the time
 * at the start and at the warning, not every second.
 */
export default function BlitzRing({
  seconds,
  fraction,
  paused,
}: {
  /** Whole seconds left, rounded up. */
  seconds: number;
  /** Share of the round left, 1 down to 0. */
  fraction: number;
  /** The clock is waiting (for the photo to load, or for the tab to be seen again). */
  paused: boolean;
}) {
  const warn = seconds <= BLITZ_WARN_SECONDS;
  const announced = warn
    ? `${BLITZ_WARN_SECONDS} seconds or less left`
    : `Blitz: ${BLITZ_SECONDS} seconds a photo`;
  return (
    <div
      className="relative grid size-12 shrink-0 place-items-center rounded-full bg-ocean-deep/70 backdrop-blur"
      data-testid="blitz-clock"
      data-seconds={seconds}
      data-paused={paused ? "true" : "false"}
      title={paused ? "Clock paused" : `${seconds} seconds left`}
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-12 -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" className="stroke-chalk/15" />
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)))}
          className={warn ? "stroke-flare" : "stroke-gold"}
        />
      </svg>
      <span
        aria-hidden="true"
        className={`relative font-sign tabular text-lg font-bold ${warn ? "text-flare" : "text-chalk"}`}
      >
        {seconds}
      </span>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </div>
  );
}
