import type { ScoredGuess } from "@/lib/atlasReport";
import { formatDistance } from "@/lib/geo";

import AtlasEyes from "./AtlasEyes";

/** A row of photos with where they really are and where Atlas put them. */
export default function GuessGallery({ rows, label }: { rows: ScoredGuess[]; label: string }) {
  return (
    <ul aria-label={label} className="mt-6 grid gap-4 sm:grid-cols-3">
      {rows.map((r) => (
        <li
          key={r.photo.id}
          className="overflow-hidden rounded-xl border border-graticule/70 bg-ocean-deep"
        >
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote Commons photos, static export */}
            <img
              src={r.photo.imageUrl}
              alt={`Photo taken in ${r.photo.place}`}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
            />
            {r.guess.looked && (
              <AtlasEyes
                src={r.photo.imageUrl}
                looked={r.guess.looked}
                className="absolute bottom-2 right-2 w-20 shadow-lg"
              />
            )}
          </div>
          <div className="p-4">
            <p className="text-sm text-chalk-dim">Really</p>
            <p className="font-semibold">{r.photo.place}</p>
            <p className="mt-2 text-sm text-chalk-dim">Atlas said</p>
            <p className="text-sonar">{r.guess.guessedPlace ?? "somewhere else"}</p>
            <p className="mt-2 font-sign tabular text-2xl font-bold">
              {formatDistance(r.distanceKm)}
              <span className="ml-1 text-sm font-normal text-chalk-dim">off</span>
            </p>
            <p className="mt-3 text-xs text-chalk-dim">
              <a
                href={r.photo.credit.sourceUrl}
                className="underline underline-offset-2 hover:text-chalk"
              >
                {r.photo.credit.author}
              </a>
              , {r.photo.credit.license}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
