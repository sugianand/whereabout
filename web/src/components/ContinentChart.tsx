import type { ContinentRow } from "@/lib/atlasReport";

const km = (x: number) => `${Math.round(x).toLocaleString("en-US")} km`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Round a scale maximum up to a tidy number of kilometres (1, 2 or 5 × a power of ten). */
export function niceMax(x: number): number {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  return ([1, 2, 5, 10].find((m) => m * p >= x) ?? 10) * p;
}

/**
 * Atlas's median error per continent as horizontal bars on one shared scale from zero.
 * Bars use Atlas's colour (sonar) everywhere on the site; text stays in text colours.
 */
export default function ContinentChart({ rows }: { rows: ContinentRow[] }) {
  const max = niceMax(Math.max(...rows.map((r) => r.medianKm)));
  const ticks = [0, max / 2, max];
  const labelW = 150;
  const valueW = 92;
  const W = 640;
  const plotW = W - labelW - valueW;
  const rowH = 44;
  const top = 8;
  const H = top + rows.length * rowH + 28;
  const x = (v: number) => labelW + (v / max) * plotW;

  return (
    <figure className="mt-6">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Atlas's median error by continent"
        className="w-full"
      >
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={top}
                y2={H - 24}
                stroke="var(--color-graticule)"
                strokeOpacity={0.6}
                strokeWidth={1}
              />
              <text
                x={x(t)}
                y={H - 6}
                textAnchor="middle"
                fontSize={12}
                fill="var(--color-chalk-dim)"
                className="tabular"
              >
                {km(t)}
              </text>
            </g>
          ))}
        </g>
        {rows.map((r, i) => {
          const y = top + i * rowH;
          const barW = Math.max(x(r.medianKm) - labelW, 2);
          return (
            <g key={r.continent}>
              <title>{`${r.continent}: median error ${km(r.medianKm)} over ${r.n} photo${
                r.n === 1 ? "" : "s"
              }; right country ${pct(r.countryAccuracy)}`}</title>
              {/* A full-row hit target, so the tooltip shows anywhere along the row. */}
              <rect x={0} y={y} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 19} fontSize={15} fill="var(--color-chalk)">
                {r.continent}
              </text>
              <text x={0} y={y + 36} fontSize={12} fill="var(--color-chalk-dim)">
                {`${r.n} photo${r.n === 1 ? "" : "s"} · country ${pct(r.countryAccuracy)}`}
              </text>
              <rect
                x={labelW}
                y={y + 12}
                width={barW}
                height={16}
                rx={4}
                fill="var(--color-sonar)"
                fillOpacity={0.85}
              />
              <text
                x={labelW + barW + 8}
                y={y + 25}
                fontSize={14}
                fill="var(--color-chalk)"
                className="tabular"
              >
                {km(r.medianKm)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <table>
          <thead>
            <tr>
              <th>Continent</th>
              <th>Photos</th>
              <th>Median error</th>
              <th>Right country</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.continent}>
                <td>{r.continent}</td>
                <td>{r.n}</td>
                <td>{km(r.medianKm)}</td>
                <td>{pct(r.countryAccuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
