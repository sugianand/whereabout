import { markGeometry, markShapeAt, svgPoints } from "@/lib/closenessMarks";

/**
 * A closeness band's shape (`lib/closenessMarks.ts`) as a small inline SVG, beside the words or
 * numbers that say the same thing, so it is hidden from screen readers.
 */
export default function ClosenessMark({
  band,
  color,
  size = 14,
  className = "",
}: {
  /** The band's index, 0 for the closest. */
  band: number;
  color: string;
  size?: number;
  className?: string;
}) {
  const shape = markShapeAt(band);
  const g = markGeometry(shape, 12, 12, 11);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`inline-block shrink-0 ${className}`}
      data-mark={shape}
    >
      {g.kind === "circle" ? (
        <circle cx={g.cx} cy={g.cy} r={g.r} fill={color} />
      ) : (
        <polygon points={svgPoints(g.points)} fill={color} />
      )}
    </svg>
  );
}
