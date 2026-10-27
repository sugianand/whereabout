"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { countryAt } from "@/lib/countryHit";
import { formatDistance, formatPoints, haversineKm, scoreDistance, type LngLat } from "@/lib/geo";
import { loadEncoder, type DownloadProgress, type ImageEncoder } from "@/lib/pocket/encoder";
import {
  declineMessage,
  gateOf,
  screen,
  type GateVerdict,
  type PocketGate,
  type PrivacyReason,
} from "@/lib/pocket/gate";
import { IndexUnavailable, loadIndex } from "@/lib/pocket/index";
import { surenessLine, type SurenessBand } from "@/lib/game/sureness";
import {
  countryProbabilities,
  locate,
  type PocketGuess,
  type PocketIndex,
} from "@/lib/pocket/locate";
import { centreCropBox, DELETION_K, explain, type PocketLooked } from "@/lib/pocket/saliency";
import type { RevealView } from "@/lib/reveal";

import AtlasEyes from "./AtlasEyes";
import Globe from "./Globe";

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; progress: DownloadProgress | null }
  | { kind: "thinking" }
  | { kind: "declined"; reasons: PrivacyReason[] }
  | { kind: "guessed"; guess: PocketGuess }
  | {
      kind: "revealed";
      guess: PocketGuess;
      truth: LngLat;
      distanceKm: number;
      score: number;
      /** The country the player pinned (null over the sea) and how sure Atlas was of it. */
      truthCountry: { code: string; p: number } | null;
    }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/** "Where Atlas looked" on the current photo: on request only, as it costs ~55 model passes. */
type Looking =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; looked: PocketLooked; country: string }
  | { kind: "error"; message: string };

/** Thrown inside a "Where Atlas looked" run once its photo has been replaced. */
class Superseded extends Error {}

export interface PocketDeps {
  loadIndex: () => Promise<PocketIndex>;
  loadEncoder: (
    modelId: string,
    onProgress: (p: DownloadProgress) => void,
  ) => Promise<ImageEncoder>;
}

const DEFAULT_DEPS: PocketDeps = { loadIndex: () => loadIndex(), loadEncoder };

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** A country the index doesn't list (the player can pin anywhere) still gets a name. */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "87%", or "under 1%" for a country Atlas all but ruled out (never a misleading "0%"). */
const sureOf = (p: number) => (p < 0.01 ? "under 1%" : pct(p));

/** "cut it by 62%" or, when hiding patches made Atlas surer, "raised it by 3%". */
const dropOf = (d: number) => (d >= 0 ? `cut it by ${pct(d)}` : `raised it by ${pct(-d)}`);

declare global {
  interface Window {
    /**
     * The last embedding, gate verdict and guess (null when the gate declined the photo), for
     * the browser-vs-PyTorch parity test (e2e/pocket.spec.ts).
     */
    __pocketAtlas?: {
      embedding: number[];
      gate: GateVerdict;
      guess: PocketGuess | null;
      model: string;
      /** "Where Atlas looked", once the player asks for it. */
      looked?: PocketLooked;
    };
  }
}

/**
 * "Your photo": Atlas guesses where a photo of yours was taken, entirely on your device, then
 * you show it where it really was.
 */
export default function PocketAtlas({ deps = DEFAULT_DEPS }: { deps?: PocketDeps }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [truth, setTruth] = useState<LngLat | null>(null);
  const [dragging, setDragging] = useState(false);
  const ready = useRef<Promise<{
    index: PocketIndex;
    gate: PocketGate;
    encoder: ImageEncoder;
  }> | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [sureness, setSureness] = useState<readonly SurenessBand[] | null>(null);
  const [looking, setLooking] = useState<Looking>({ kind: "idle" });
  // The photo being guessed, and a counter that retires a "Where Atlas looked" run when it changes.
  const photoFile = useRef<File | null>(null);
  const photoRun = useRef(0);

  // Free the preview's object URL when the photo changes or the page goes away.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const prepare = useCallback(() => {
    if (!ready.current) {
      ready.current = (async () => {
        const index = await deps.loadIndex();
        // No privacy gate, no guesses: an index built before the gate stays closed, before the
        // 180 MB model is downloaded for nothing.
        const gate = gateOf(index.meta);
        if (!gate) throw new IndexUnavailable("Pocket Atlas's privacy gate isn't published yet.");
        setNames(new Map(index.meta.countries.map((c) => [c.code, c.name])));
        setSureness(index.meta.sureness ?? null);
        const encoder = await deps.loadEncoder(index.meta.hfModel, (progress) =>
          setPhase((p) => (p.kind === "loading" ? { kind: "loading", progress } : p)),
        );
        return { index, gate, encoder };
      })();
      // A failed load can be retried with the next photo.
      ready.current.catch(() => (ready.current = null));
    }
    return ready.current;
  }, [deps]);

  async function guessFor(file: File) {
    if (!file.type.startsWith("image/")) {
      setPhase({ kind: "error", message: "That isn't a photo. Try a JPEG, PNG or HEIC image." });
      return;
    }
    setPhoto(URL.createObjectURL(file));
    photoFile.current = file;
    photoRun.current += 1;
    setLooking({ kind: "idle" });
    setTruth(null);
    setPhase({ kind: "loading", progress: null });
    try {
      const { index, gate, encoder } = await prepare();
      setPhase({ kind: "thinking" });
      const embedding = await encoder.embed(file);
      // The privacy gate runs first: a declined photo is never located at all.
      const verdict = screen(gate, embedding);
      const guess = verdict.passed ? locate(index, embedding) : null;
      window.__pocketAtlas = {
        embedding: Array.from(embedding),
        gate: verdict,
        guess,
        model: index.meta.model,
      };
      setPhase(guess ? { kind: "guessed", guess } : { kind: "declined", reasons: verdict.reasons });
    } catch (err) {
      setPhase(
        err instanceof IndexUnavailable
          ? { kind: "unavailable" }
          : { kind: "error", message: (err as Error).message || "Something went wrong." },
      );
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void guessFor(file);
  }

  /** Occlusion saliency for the current photo, entirely on the device (lib/pocket/saliency.ts). */
  async function lookAgain(country: string) {
    const file = photoFile.current;
    if (!file || !ready.current) return;
    const run = photoRun.current;
    const live = () => {
      if (photoRun.current !== run) throw new Superseded();
    };
    setLooking({ kind: "running", done: 0, total: 0 });
    try {
      const { index, encoder } = await ready.current;
      const at = index.meta.countries.findIndex((c) => c.code === country);
      if (at < 0) throw new Error("Atlas can't explain a country outside its index.");
      const { pixels, width, height } = await encoder.prepare(file);
      const looked = await explain(
        pixels,
        centreCropBox(width, height),
        async (px) => {
          live();
          const p = countryProbabilities(index, await encoder.embedPixels(px))[at];
          return Math.log(Math.max(p, 1e-300));
        },
        {
          onProgress: (done, total) => {
            live();
            setLooking({ kind: "running", done, total });
          },
        },
      );
      live();
      if (window.__pocketAtlas) window.__pocketAtlas.looked = looked;
      setLooking({ kind: "done", looked, country });
    } catch (err) {
      if (err instanceof Superseded) return;
      setLooking({ kind: "error", message: (err as Error).message || "Something went wrong." });
    }
  }

  function reveal() {
    if (phase.kind !== "guessed" || !truth) return;
    const distanceKm = haversineKm(phase.guess, truth);
    const code = countryAt(truth);
    setPhase({
      kind: "revealed",
      guess: phase.guess,
      truth,
      distanceKm,
      score: scoreDistance(distanceKm),
      // A country below the heatmap's half a percent was as good as ruled out.
      truthCountry: code ? { code, p: phase.guess.belief[code] ?? 0 } : null,
    });
  }

  const guess = phase.kind === "guessed" || phase.kind === "revealed" ? phase.guess : null;
  const revealView: RevealView | null =
    phase.kind === "revealed"
      ? {
          truth: phase.truth,
          guesses: [{ actor: "atlas", at: phase.guess }],
          // The heatmap, as at the game's reveal: every country shaded by how sure Atlas was.
          belief: phase.guess.belief,
        }
      : null;
  const countryName = (code: string) => names.get(code) ?? regionName(code);
  const busy = phase.kind === "loading" || phase.kind === "thinking";
  // The reveal's reality check, from this model's own held-out bands (null when too few photos).
  const realityCheck = guess && sureness ? surenessLine(sureness, guess.confidence) : null;

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-2">
      <section aria-label="Your photo">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`relative block aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition ${
            dragging ? "border-sonar bg-sonar/10" : "border-graticule hover:border-chalk-dim"
          } ${busy ? "pointer-events-none" : ""}`}
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void guessFor(file);
              e.target.value = "";
            }}
          />
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL
            <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center p-6 text-center">
              <span>
                <span className="block font-sign text-3xl font-bold">Drop a photo here</span>
                <span className="mt-2 block text-chalk-dim">or tap to choose one, or take one</span>
              </span>
            </span>
          )}
          {phase.kind === "thinking" && (
            <span className="wb-scan absolute inset-0" aria-hidden="true" />
          )}
        </label>
        <p className="mt-3 text-sm text-chalk-dim">
          Your photo never leaves this device: Atlas runs right here in your browser. Outdoor photos
          work best. Atlas only ever names a city, never an address, and it won&apos;t guess photos
          of people or of indoor spaces.
        </p>
      </section>

      <section aria-live="polite" aria-label="Atlas's guess" className="min-w-0">
        {phase.kind === "idle" && (
          <p className="text-chalk-dim">
            Atlas has never seen your photo. Give it one and watch it reason its way to a country,
            then a city.
          </p>
        )}

        {phase.kind === "loading" && (
          <div>
            <p className="font-sign text-2xl font-bold">Waking Atlas up…</p>
            <p className="mt-2 text-chalk-dim">
              The first time, your browser downloads Atlas&apos;s eyes (a vision model of about 180
              MB). After that it is cached, so the next photo is instant.
            </p>
            <div
              role="progressbar"
              aria-label="Downloading Atlas"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                phase.progress?.total
                  ? Math.round((phase.progress.loaded / phase.progress.total) * 100)
                  : 0
              }
              className="mt-4 h-2 overflow-hidden rounded-full bg-chalk/15"
            >
              <div
                className="h-full rounded-full bg-sonar transition-[width]"
                style={{
                  width: phase.progress?.total
                    ? `${(phase.progress.loaded / phase.progress.total) * 100}%`
                    : "4%",
                }}
              />
            </div>
            {phase.progress?.total ? (
              <p className="mt-2 tabular text-sm text-chalk-dim">
                {mb(phase.progress.loaded)} of {mb(phase.progress.total)}
              </p>
            ) : null}
          </div>
        )}

        {phase.kind === "thinking" && (
          <p className="font-sign text-2xl font-bold">Atlas is looking at your photo…</p>
        )}

        {phase.kind === "unavailable" && (
          <p role="alert" className="text-chalk-dim">
            Pocket Atlas isn&apos;t published yet. It appears after Atlas&apos;s next run, usually
            within a day.
          </p>
        )}

        {phase.kind === "declined" && (
          <div role="alert" data-testid="pocket-declined">
            <p className="font-sign text-2xl font-bold">Atlas is keeping this one private</p>
            <p className="mt-2 text-chalk-dim">{declineMessage(phase.reasons)}</p>
          </div>
        )}

        {phase.kind === "error" && (
          <p role="alert" className="text-flare">
            {phase.message}
          </p>
        )}

        {guess && (
          <div>
            <p className="text-sm text-chalk-dim">Atlas thinks this is</p>
            <h2 className="font-sign text-5xl font-extrabold leading-tight text-sonar">
              {guess.city}
            </h2>
            <p className="text-xl">{countryName(guess.country)}</p>
            <p className="mt-2 text-sm text-chalk-dim">
              {pct(guess.confidence)} sure of the country.
              {realityCheck && <span data-testid="pocket-sureness"> {realityCheck}</span>}
            </p>

            <ol aria-label="Atlas's most likely countries" className="mt-5 space-y-2">
              {guess.topCountries.map((c) => (
                <li key={c.country} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
                  <span className="truncate">{countryName(c.country)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-chalk/10">
                    <span
                      className="block h-full rounded-full bg-sonar"
                      style={{ width: `${Math.max(2, c.p * 100)}%` }}
                    />
                  </span>
                  <span className="tabular text-right text-sm text-chalk-dim">{pct(c.p)}</span>
                </li>
              ))}
            </ol>

            {guess.clues.length > 0 && (
              <ul aria-label="What Atlas noticed" className="mt-4 flex flex-wrap gap-2">
                {guess.clues.map((clue) => (
                  <li
                    key={clue.label}
                    className="rounded-full border border-sonar/40 px-3 py-1 text-sm text-sonar"
                  >
                    {clue.label} <span className="tabular text-chalk-dim">{pct(clue.p)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6" data-testid="pocket-looked">
              {looking.kind === "idle" && (
                <>
                  <button
                    type="button"
                    onClick={() => void lookAgain(guess.country)}
                    className="rounded-full border border-sonar/60 px-5 py-2 text-sm font-semibold text-sonar transition hover:bg-sonar/10"
                  >
                    Where did Atlas look?
                  </button>
                  <p className="mt-2 text-xs text-chalk-dim">
                    Atlas hides one patch of your photo at a time and looks again, about 55 times,
                    still on your device. It can take a minute on a phone.
                  </p>
                </>
              )}
              {looking.kind === "running" && (
                <div>
                  <p className="text-sm">Atlas is hiding patches of your photo…</p>
                  <div
                    role="progressbar"
                    aria-label="Finding where Atlas looked"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      looking.total ? Math.round((looking.done / looking.total) * 100) : 0
                    }
                    className="mt-2 h-2 max-w-xs overflow-hidden rounded-full bg-chalk/15"
                  >
                    <div
                      className="h-full rounded-full bg-sonar transition-[width]"
                      style={{
                        width: looking.total ? `${(looking.done / looking.total) * 100}%` : "4%",
                      }}
                    />
                  </div>
                </div>
              )}
              {looking.kind === "done" && photo && (
                <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
                  <AtlasEyes src={photo} looked={looking.looked} className="w-48" />
                  <p className="text-sm text-chalk-dim">
                    The glow is where hiding the photo hurt Atlas&apos;s belief in{" "}
                    {countryName(looking.country)} most. Hiding the {DELETION_K} patches it leaned
                    on most {dropOf(looking.looked.topKDrop)}; hiding {DELETION_K} random patches{" "}
                    {dropOf(looking.looked.randomKDrop)}.{" "}
                    {looking.looked.topKDrop > looking.looked.randomKDrop
                      ? "So the glow does show what this guess rests on."
                      : "So for this photo the glow is a weak guide: no one part carried the guess."}
                  </p>
                </div>
              )}
              {looking.kind === "error" && (
                <p role="alert" className="text-sm text-flare">
                  {looking.message}
                </p>
              )}
            </div>

            <div className="mt-6">
              <p className="font-semibold">
                {phase.kind === "revealed"
                  ? "Here's how close Atlas got."
                  : "Was it right? Tap the globe where the photo was really taken."}
              </p>
              <div className="mt-3 h-80 overflow-hidden rounded-2xl border border-graticule/70">
                <Globe
                  pin={truth}
                  onPinChange={setTruth}
                  disabled={phase.kind !== "guessed"}
                  reveal={revealView}
                  className="h-full"
                />
              </div>
              {phase.kind === "guessed" && (
                <button
                  type="button"
                  onClick={reveal}
                  disabled={!truth}
                  className="mt-4 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
                >
                  {truth ? "That's where it was" : "Place a pin first"}
                </button>
              )}
              {phase.kind === "revealed" && (
                <p className="mt-4 text-xl">
                  Atlas was{" "}
                  <strong className="tabular text-sonar">{formatDistance(phase.distanceKm)}</strong>{" "}
                  off, worth <strong className="tabular">{formatPoints(phase.score)}</strong> points
                  in the game.
                </p>
              )}
              {phase.kind === "revealed" && (
                <p className="mt-2 text-sm text-chalk-dim" data-testid="pocket-heatmap">
                  The shading is how sure Atlas was of each country: the darker, the surer.
                  {phase.truthCountry && (
                    <>
                      {" "}
                      It gave {countryName(phase.truthCountry.code)}{" "}
                      <strong className="tabular text-chalk">{sureOf(phase.truthCountry.p)}</strong>
                      .
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
