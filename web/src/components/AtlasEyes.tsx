import type { AtlasLooked } from "@/lib/game/types";
import { describeHotspot, isValidLooked } from "@/lib/looked";

type AtlasEyesProps = {
  src: string;
  looked: AtlasLooked;
  className?: string;
};

/**
 * The square of the photo that Atlas actually saw, with a glow where hiding the photo hurt
 * Atlas's guess most. Cells are blurred together so the grid reads as a heatmap, not tiles.
 */
export default function AtlasEyes({ src, looked, className = "" }: AtlasEyesProps) {
  if (!isValidLooked(looked)) return null;
  const [x, y, w, h] = looked.crop;
  const where = describeHotspot(looked);
  const label = where
    ? `Where Atlas looked: mostly ${where} of the photo`
    : "Where Atlas looked: no single part of the photo stood out";

  return (
    <div
      role="img"
      aria-label={label}
      className={`relative aspect-square overflow-hidden rounded-lg border border-sonar/40 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- remote Commons photo, static export */}
      <img
        src={src}
        alt=""
        className="absolute max-w-none brightness-[0.55] saturate-50"
        style={{
          width: `${100 / w}%`,
          height: `${100 / h}%`,
          left: `${(-x / w) * 100}%`,
          top: `${(-y / h) * 100}%`,
        }}
      />
      <div
        aria-hidden="true"
        data-testid="atlas-eyes-heat"
        className="absolute inset-0 grid mix-blend-screen blur-[6px]"
        style={{
          gridTemplateColumns: `repeat(${looked.grid}, 1fr)`,
          gridTemplateRows: `repeat(${looked.grid}, 1fr)`,
        }}
      >
        {looked.cells.map((v, i) => (
          <div key={i} className="bg-sonar" style={{ opacity: Math.min(1, v * 0.9) }} />
        ))}
      </div>
    </div>
  );
}
