"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { buildAlbum, eachLimited, percentFound, type AlbumContinent } from "@/lib/album";
import type { Continent } from "@/lib/continents";
import { closenessOf } from "@/lib/feel";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { regionSlug, type Regions } from "@/lib/game/regions";
import { formatDistance } from "@/lib/geo";
import { BANDS, loadPlayed, type PlayedPhoto } from "@/lib/playedMap";
import { useColorScheme } from "@/lib/useTheme";
import { useUnits } from "@/lib/useUnits";

import AlbumShare from "./AlbumShare";
import AlbumViewer from "./AlbumViewer";
import { cardImage } from "./ClosestCalls";
import ClosenessMark from "./ClosenessMark";
import { BAND_SCHEMES } from "./PlayedMap";

/** Photos shown on a continent before "Show all". */
export const ALBUM_FIRST = 10;

/** Records asked of the static host at once. */
const FETCH_LIMIT = 4;

export interface AlbumProps {
  deck: Pick<Deck, "version" | "regions">;
  /** Each dealt photo's continent, and nothing else about it. */
  continents: Record<string, Continent>;
  /** For tests: the history instead of this browser's. */
  history?: readonly PlayedPhoto[];
  /** For tests: load one photo's record without the network. Defaults to the static files. */
  loadRecord?: (id: string) => Promise<GameRecord>;
}

type Loaded = Record<string, GameRecord | "failed">;

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Your album: the photos you've played, continent by continent, each with how close your pin
 * landed, and how many each continent still holds for you to find, with a game there to find
 * them. Read from this browser after mount; photos' pictures come from their records, fetched a
 * few at a time and only for the photos on screen.
 */
export default function Album({ deck, continents, history, loadRecord }: AlbumProps) {
  const [played, setPlayed] = useState<readonly PlayedPhoto[] | null>(history ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<Continent>>(new Set());
  const [loaded, setLoaded] = useState<Loaded>({});
  // The photo open in the viewer: its continent and place on that continent's page.
  const [open, setOpen] = useState<{ continent: Continent; index: number } | null>(null);

  useEffect(() => {
    if (history) return;
    // Storage only exists in the browser, so the history is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayed(loadPlayed());
  }, [history]);

  const album = useMemo(() => buildAlbum(continents, played ?? []), [continents, played]);

  const openRow = open ? album.continents.find((r) => r.continent === open.continent) : undefined;

  // The photos on screen, in page order: each continent's first few, or all once expanded,
  // then the open photo and its neighbours, so turning the page finds them ready.
  const shown = useMemo(() => {
    const ids = album.continents.flatMap((row) =>
      (expanded.has(row.continent) ? row.found : row.found.slice(0, ALBUM_FIRST)).map((p) => p.id),
    );
    if (open && openRow) {
      for (const i of [open.index, open.index + 1, open.index - 1]) {
        const id = openRow.found[i]?.id;
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }, [album, expanded, open, openRow]);
  const shownKey = shown.join(",");

  useEffect(() => {
    let cancelled = false;
    const load =
      loadRecord ?? ((id: string) => fetchRecords(deck, [id]).then(([record]) => record));
    const wanted = shownKey ? shownKey.split(",") : [];
    const todo = wanted.filter((id) => !(id in loaded));
    void eachLimited(
      todo,
      FETCH_LIMIT,
      async (id) => {
        const record = await load(id).then(
          (r): GameRecord | "failed" => r,
          (): "failed" => "failed",
        );
        if (!cancelled) setLoaded((prev) => ({ ...prev, [id]: record }));
      },
      () => cancelled,
    );
    return () => {
      cancelled = true;
    };
    // `loaded` is read only to skip what is already in; adding it would refetch on every arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, deck, loadRecord]);

  if (played === null) return null;

  const pct = percentFound(album.found, album.total);

  return (
    <>
      <section aria-labelledby="album-count" className="mt-8 max-w-2xl">
        <p id="album-count" className="text-lg">
          <span className="font-sign text-4xl font-extrabold text-gold" data-testid="album-found">
            {count(album.found)}
          </span>{" "}
          of {count(album.total)} photos found
        </p>
        <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-graticule/60">
          <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
        </div>
        {album.found === 0 && (
          <p className="mt-4 text-chalk-dim">
            Your album is empty for now. Every photo you play in a game lands here, under its
            continent.{" "}
            <Link href="/" className="font-semibold text-sonar underline-offset-2 hover:underline">
              Play a game →
            </Link>
          </p>
        )}
        {album.found > 0 && album.found < album.total && (
          <p className="mt-4 text-chalk-dim">
            A game of five photos you haven&apos;t found yet, from anywhere.{" "}
            <Link
              href="/?find"
              className="font-semibold text-sonar underline-offset-2 hover:underline"
            >
              Find the rest →
            </Link>
          </p>
        )}
        {album.total > 0 && album.found >= album.total && (
          <p className="mt-4 font-semibold text-gold">
            Your album is full: you&apos;ve found every photo the game deals.
          </p>
        )}
        {album.found > 0 && <AlbumShare album={album} />}
      </section>

      {album.continents.map((row) => (
        <ContinentPage
          key={row.continent}
          row={row}
          regions={deck.regions}
          expanded={expanded.has(row.continent)}
          onShowAll={() => setExpanded((prev) => new Set(prev).add(row.continent))}
          loaded={loaded}
          onOpen={(index) => setOpen({ continent: row.continent, index })}
        />
      ))}

      {open && openRow && (
        <AlbumViewer
          continent={open.continent}
          photos={openRow.found}
          index={open.index}
          loaded={loaded}
          onIndex={(index) => setOpen({ continent: open.continent, index })}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function ContinentPage({
  row,
  regions,
  expanded,
  onShowAll,
  loaded,
  onOpen,
}: {
  row: AlbumContinent;
  regions: Regions;
  expanded: boolean;
  onShowAll: () => void;
  loaded: Loaded;
  onOpen: (index: number) => void;
}) {
  const units = useUnits();
  const bands = BAND_SCHEMES[useColorScheme() === "light" ? "day" : "night"];
  const id = `album-${regionSlug(row.continent)}`;
  const left = row.total - row.found.length;
  const listed = expanded ? row.found : row.found.slice(0, ALBUM_FIRST);
  const playable = (regions[row.continent]?.length ?? 0) > 0;

  return (
    <section className="mt-12" aria-labelledby={id} data-testid="album-continent">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="font-sign text-3xl font-extrabold">
          {row.continent}
        </h2>
        <p className="text-sm text-chalk-dim tabular-nums">
          {count(row.found.length)} of {count(row.total)} found
        </p>
      </div>
      <ul
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label={`${row.continent}: photos found`}
      >
        {listed.map((p, i) => {
          const got = loaded[p.id];
          const photo = got && got !== "failed" && got.photo.id === p.id ? got.photo : null;
          const band = closenessOf(p.km);
          return (
            <li
              key={p.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-graticule bg-ocean-deep"
              data-testid="album-photo"
            >
              <button
                type="button"
                onClick={() => onOpen(i)}
                aria-label={`Open your photo from ${p.place}`}
                className="block aspect-[4/3] w-full bg-graticule/40 transition hover:opacity-90"
              >
                {photo && (
                  // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cardImage(photo.imageUrl)}
                    alt={`Your photo from ${p.place}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
              <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
                <p className="line-clamp-2 font-semibold leading-snug" title={p.place}>
                  {p.place}
                </p>
                <p className="flex items-center gap-1.5 text-xs tabular-nums">
                  <ClosenessMark band={BANDS.indexOf(band)} color={bands[band]} size={12} />
                  <span>{p.km === null ? "No pin" : `${formatDistance(p.km, units)} off`}</span>
                </p>
                {photo && (
                  <p className="mt-auto truncate pt-1 text-[11px] text-chalk-dim">
                    <a
                      href={photo.credit.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {photo.credit.author}
                    </a>
                    , {photo.credit.license}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {left > 0 && (
          <li
            className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-chalk/30 p-4 text-center text-sm"
            data-testid="album-left"
          >
            <span className="font-sign text-3xl font-extrabold tabular-nums">{count(left)}</span>
            <span className="text-chalk-dim">{left === 1 ? "photo" : "photos"} still to find</span>
            {playable && (
              <Link
                href={`/?find=${regionSlug(row.continent)}`}
                className="font-semibold text-sonar underline-offset-2 hover:underline"
              >
                Find them in {row.continent} →
              </Link>
            )}
          </li>
        )}
      </ul>
      {!expanded && row.found.length > ALBUM_FIRST && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 rounded-full border border-chalk/30 px-4 py-2 text-sm font-semibold transition hover:border-chalk"
        >
          Show all {count(row.found.length)} from {row.continent}
        </button>
      )}
    </section>
  );
}
