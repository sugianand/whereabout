import type { Metadata } from "next";
import Link from "next/link";

import ContinentChart from "@/components/ContinentChart";
import GuessGallery from "@/components/GuessGallery";
import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { systemLabel } from "@/lib/atlas";
import { byContinent, extremes, scoreGuesses } from "@/lib/atlasReport";
import type { AtlasData, AtlasSystemResult, CatalogPhoto } from "@/lib/game/types";

export const metadata: Metadata = {
  title: "How Atlas guesses — Whereabout",
  description:
    "Atlas, the AI you play against in Whereabout, narrows the planet down to one city in three steps. Here is how, and how often it gets it right.",
};

const atlas = atlasData as AtlasData;
const REPO = "https://github.com/sugianand/whereabout";

// Computed at build time from the files the game ships, with the game's own scoring.
const scored = scoreGuesses(catalog as CatalogPhoto[], atlas);
const continents = byContinent(scored);
const { best, worst } = extremes(scored, 3);
const saliency = atlas.evaluation?.saliency;
const pctWhole = (x: number) => `${Math.round(x * 100)}%`;

const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? "–" : `${(x * 100).toFixed(1)}%`;
const km = (x: number) => `${Math.round(x).toLocaleString("en-US")} km`;

function ResultsTable({ systems }: { systems: AtlasSystemResult[] }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-graticule/70">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">
          How close each system got, on the same {atlas.evaluation?.n} photos
        </caption>
        <thead className="bg-ocean-deep text-chalk-dim">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              System
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Within 25 km
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Within 750 km
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Right country
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Median error
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Average points
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-graticule/50">
          {systems.map((s) => (
            <tr key={s.name} className={s.playsInGame ? "bg-sonar/10" : undefined}>
              <th scope="row" className="px-4 py-3 font-normal">
                <span className={s.playsInGame ? "text-sonar" : undefined}>
                  {systemLabel(s.name)}
                </span>
                {s.playsInGame && (
                  <span className="block text-xs text-chalk-dim">The Atlas you play against</span>
                )}
              </th>
              <td className="tabular px-4 py-3 text-right">{pct(s.accuracy_at_km["25"])}</td>
              <td className="tabular px-4 py-3 text-right">{pct(s.accuracy_at_km["750"])}</td>
              <td className="tabular px-4 py-3 text-right">{pct(s.country_accuracy)}</td>
              <td className="tabular px-4 py-3 text-right">
                {km(s.median_km)}
                {s.median_km_ci95?.length === 2 && (
                  <span className="block text-xs text-chalk-dim">
                    {km(s.median_km_ci95[0])} to {km(s.median_km_ci95[1])}
                  </span>
                )}
              </td>
              <td className="tabular px-4 py-3 text-right">
                {Math.round(s.mean_score).toLocaleString("en-US")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AtlasPage() {
  const systems = atlas.evaluation?.systems ?? [];
  const generated = atlas.generatedAt
    ? new Date(atlas.generatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>

      <h1 className="mt-12 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        How Atlas guesses
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-chalk-dim">
        Atlas is the AI you play against. Nobody has told it where any of these photos were taken.
        It reads each one with CLIP, a model trained to match pictures with descriptions, and
        narrows the whole planet down to one city in three steps.
      </p>

      <ol className="mt-12 space-y-10">
        <li className="grid grid-cols-[2.5rem_1fr] gap-x-4">
          <span className="font-sign text-4xl font-bold text-sonar">1</span>
          <div>
            <h2 className="font-sign text-3xl font-bold">Read the photo</h2>
            <p className="mt-2 text-chalk-dim">
              CLIP turns the photo into a long list of numbers that captures what is in it: the
              light, the plants, the roofs, the road markings. Descriptions in words get turned into
              numbers the same way, so a photo and a sentence can be compared directly.
            </p>
          </div>
        </li>
        <li className="grid grid-cols-[2.5rem_1fr] gap-x-4">
          <span className="font-sign text-4xl font-bold text-sonar">2</span>
          <div>
            <h2 className="font-sign text-3xl font-bold">Pick a country</h2>
            <p className="mt-2 text-chalk-dim">
              Atlas compares the photo with sentences like &ldquo;a photo taken in Peru&rdquo; for
              every country, in three phrasings averaged together, and turns the matches into
              probabilities that add up to 100%.
            </p>
          </div>
        </li>
        <li className="grid grid-cols-[2.5rem_1fr] gap-x-4">
          <span className="font-sign text-4xl font-bold text-sonar">3</span>
          <div>
            <h2 className="font-sign text-3xl font-bold">Pick a city</h2>
            <p className="mt-2 text-chalk-dim">
              In its three most likely countries, Atlas compares the photo with &ldquo;a photo taken
              in Cusco, Peru&rdquo; for each country&apos;s 40 largest cities. Its guess is the city
              with the highest chance overall: how likely the country is, times how likely the city
              is within it.
            </p>
          </div>
        </li>
      </ol>

      <p className="mt-10 text-chalk-dim">
        The clues you see after each round, like &ldquo;Snow and ice&rdquo; or &ldquo;No
        buildings&rdquo;, come from the same trick: Atlas compares the photo with a few descriptions
        of the scene and only shows a clue when one clearly wins.
      </p>

      <h2 className="mt-16 font-sign text-4xl font-bold">Where Atlas looks</h2>
      <p className="mt-4 text-chalk-dim">
        CLIP only ever sees a square from the middle of each photo. To find out which parts of that
        square Atlas relies on, it is split into a {saliency?.grid ?? 7}×{saliency?.grid ?? 7} grid
        and Atlas guesses again with one cell greyed out at a time. Where hiding a cell makes Atlas
        much less sure of its country, that cell glows. It takes about fifty extra looks per photo,
        so it runs once, offline, alongside the guesses.
      </p>
      {saliency ? (
        <p className="mt-4 text-chalk-dim">
          A glowing map is only worth something if it is true, so it is tested. Hiding the{" "}
          {saliency.k} cells that glow brightest cut Atlas&apos;s confidence in its country by{" "}
          <strong className="text-sonar">{pctWhole(saliency.mean_top_k_drop)}</strong> on average;
          hiding {saliency.k} random cells cut it by{" "}
          <strong className="text-chalk">{pctWhole(saliency.mean_random_k_drop)}</strong>. The
          bright cells mattered more on {pctWhole(saliency.share_top_worse)} of the {saliency.n}{" "}
          photos.
        </p>
      ) : (
        <p className="mt-4 text-chalk-dim">
          The maps, and a test of whether they are faithful, appear after Atlas&apos;s next run.
        </p>
      )}

      <h2 className="mt-16 font-sign text-4xl font-bold">How often it gets it right</h2>
      {systems.length > 0 ? (
        <>
          <p className="mt-4 text-chalk-dim">
            Every system below played the same {atlas.evaluation?.n} photos
            {generated ? `, in a run on ${generated}` : ""}. Two models were compared, each with and
            without the city step, against two simple baselines. The most accurate one became the
            Atlas in the game.
          </p>
          <ResultsTable systems={systems} />
          <p className="mt-3 text-sm text-chalk-dim">
            Median error has a 95% confidence interval under it. Average points use the game&apos;s
            scoring, where a perfect guess is worth 5,000.
          </p>
        </>
      ) : (
        <p className="mt-4 text-chalk-dim">
          The results table appears here after Atlas&apos;s next run. Until then, the full results
          are in{" "}
          <a
            className="underline underline-offset-2"
            href={`${REPO}/blob/main/eval/results/atlas-v0.md`}
          >
            the repository
          </a>
          .
        </p>
      )}

      {scored.length > 0 && (
        <>
          <h2 className="mt-16 font-sign text-4xl font-bold">Where Atlas struggles</h2>
          <p className="mt-4 text-chalk-dim">
            Atlas&apos;s median error on the game&apos;s {scored.length} photos, split by the
            continent each photo was really taken on. Some continents have only a handful of photos,
            so treat the small groups as hints, not verdicts.
          </p>
          {continents.length > 1 && (
            <p className="mt-4 text-xl">
              Atlas is closest in <strong>{continents[0].continent}</strong> (
              {km(continents[0].medianKm)}) and furthest off in{" "}
              <strong>{continents[continents.length - 1].continent}</strong> (
              {km(continents[continents.length - 1].medianKm)}).
            </p>
          )}
          <ContinentChart rows={continents} />

          <h2 className="mt-16 font-sign text-4xl font-bold">Its best guesses</h2>
          <GuessGallery rows={best} label="Atlas's closest guesses" />

          <h2 className="mt-16 font-sign text-4xl font-bold">And its worst</h2>
          <p className="mt-4 text-chalk-dim">
            These are the clearest view of what a zero-shot model gets wrong, and the first thing a
            trained Atlas has to fix.
          </p>
          <GuessGallery rows={worst} label="Atlas's furthest guesses" />
        </>
      )}

      <h2 className="mt-16 font-sign text-4xl font-bold">Read these numbers carefully</h2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-chalk-dim">
        <li>The test set is small, so the ranges are wide.</li>
        <li>
          The photos come from Wikimedia Commons, and CLIP learned from a huge scrape of the web
          that probably included some of them. That could make Atlas look better here than on photos
          it has never seen.
        </li>
        <li>
          Atlas hasn&apos;t been trained on geography at all yet. This is the starting line that a
          trained Atlas will have to beat.
        </li>
      </ul>

      <div className="mt-16 flex flex-wrap items-center gap-6">
        <Link
          href="/"
          className="rounded-full bg-flare px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          Play today&apos;s five
        </Link>
        <a className="text-chalk-dim underline underline-offset-2 hover:text-chalk" href={REPO}>
          Code, data and results on GitHub
        </a>
      </div>
    </main>
  );
}
