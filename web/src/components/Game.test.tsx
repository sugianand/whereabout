import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { LocalBackend } from "@/lib/game/backends";
import { pickDaily } from "@/lib/game/daily";
import { LOAD_ERROR } from "@/lib/game/deck";
import { RECENT_KEY } from "@/lib/game/fresh";
import { maxPoints } from "@/lib/geo";
import { cluesFor } from "@/lib/hints";
import { INTRO_KEY, INTRO_TEXT } from "@/lib/intro";
import { playablePhotos } from "@/lib/game/playable";
import { RECORD_KEY } from "@/lib/playerRecord";
import { ROUNDS_PER_GAME } from "@/lib/game/state";
import { tierBlurb } from "@/lib/game/tiers";
import type { AtlasData, CatalogPhoto, GameBackend } from "@/lib/game/types";
import { bundledGame } from "@/test/deck";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Game, { modeTitle } from "./Game";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const TODAY = new Date("2026-10-09T15:00:00Z");
const playable = playablePhotos(catalog as CatalogPhoto[], atlasData as AtlasData);
const daily = pickDaily(playable, "2026-10-09", ROUNDS_PER_GAME);

beforeEach(() => {
  resetFakes();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  // Reduced motion: the reveal and count-ups jump straight to their final values.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia; remove the stub between tests.
  delete window.matchMedia;
});

async function mapReady() {
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  return map;
}

/** Authors are free text from Commons, e.g. "Marc Ryckaert (MJJR)": match them literally. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Generous waits: a five-round game is many renders, and CI machines are slow and busy.
const WAIT = { timeout: 4000 };

async function playRound(map: FakeMap, at: { lng: number; lat: number }) {
  await screen.findByRole("button", { name: "Zoom in on the photo" }, WAIT);
  act(() => map.click(at.lng, at.lat));
  fireEvent.click(screen.getByRole("button", { name: "Guess here" }));
  return screen.findByRole("region", { name: /./ }, WAIT);
}

describe("Game", { timeout: 20000 }, () => {
  it("titles the game with today's date", () => {
    expect(modeTitle({ kind: "daily", day: "2026-10-09" })).toBe("Daily Five, October 9");
    expect(modeTitle({ kind: "fresh", game: 2 })).toBe("Fresh game");
    expect(modeTitle({ kind: "tier", tier: "hard", game: 1 })).toBe("Hard game");
  });

  it("offers Pocket Atlas from the first screen, and hides it during the reveal", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    const map = await mapReady();
    const card = await screen.findByRole("link", { name: /Try Atlas on your photo/ });
    expect(card).toHaveAttribute("href", "/you");
    await playRound(map, daily[0]);
    expect(screen.queryByRole("link", { name: /Try Atlas on your photo/ })).toBeNull();
  });

  it("needs a pin before the player can guess", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    await mapReady();
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
  });

  it("shows today's first photo, and reveals the place, distance and credit after a guess", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    const map = await mapReady();
    const first = daily[0];

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", first.imageUrl);

    const card = await playRound(map, first);
    expect(within(card).getByRole("heading", { name: first.place })).toBeInTheDocument();
    const announced = within(card).getByText(/^You were 0 m away and scored 5,000 points\./);
    const atlasGuess = (atlasData as AtlasData).guesses[first.id];
    if (atlasGuess) {
      // Atlas played this photo: its distance and the verdict are announced too.
      expect(announced).toHaveTextContent(/Atlas was .+ away and scored [\d,]+\./);
      expect(announced).toHaveTextContent(/(You beat Atlas|Atlas got closer|A dead heat)/);
    } else {
      expect(announced).toHaveTextContent(/^You were 0 m away and scored 5,000 points\.$/);
    }
    expect(
      within(card).getByRole("link", { name: new RegExp(escapeRegExp(first.credit.author)) }),
    ).toHaveAttribute("href", first.credit.sourceUrl);
    // Focus moves in a passive effect, which can flush just after the card reaches the DOM.
    const next = within(card).getByRole("button", { name: "Next photo" });
    await waitFor(() => expect(next).toHaveFocus());
  });

  it("gives hints one at a time, each lowering what the round is worth", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    const map = await mapReady();
    const first = daily[0];
    const clues = cluesFor(first);
    expect(clues.length).toBeGreaterThan(0);
    await screen.findByRole("button", { name: "Zoom in on the photo" }, WAIT);
    expect(screen.queryByRole("list", { name: "Hints" })).toBeNull();

    for (let i = 0; i < clues.length; i++) {
      const hint = screen.getByRole("button", {
        name: `Take a hint: the round will be worth up to ${maxPoints(i + 1).toLocaleString("en-US")} points`,
      });
      fireEvent.click(hint);
      const list = await screen.findByRole("list", { name: "Hints" }, WAIT);
      await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(i + 1));
      expect(within(list).getByText(clues[i].text)).toBeInTheDocument();
    }
    // Every hint taken: the button goes.
    expect(screen.queryByRole("button", { name: /^Take a hint/ })).toBeNull();

    const card = await playRound(map, first);
    const top = maxPoints(clues.length).toLocaleString("en-US");
    expect(
      within(card).getByText(new RegExp(`^You were 0 m away and scored ${top} points\\.`)),
    ).toBeInTheDocument();
    expect(
      within(card).getAllByText(new RegExp(`worth up to ${top} points`)).length,
    ).toBeGreaterThan(0);
  });

  it("plays five rounds and ends on a summary with every place", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    const map = await mapReady();

    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const card = await playRound(map, { lng: 0, lat: 0 });
      const last = i === ROUNDS_PER_GAME - 1;
      fireEvent.click(
        within(card).getByRole("button", { name: last ? "See your results" : "Next photo" }),
      );
    }

    expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
    for (const photo of daily) expect(screen.getByText(photo.place)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();

    // The finished game joins the record in this browser, once, and starts a Daily Five streak.
    const panel = screen.getByRole("region", { name: "Your record against Atlas" });
    expect(within(panel).getByText("Games played").nextElementSibling).toHaveTextContent("1");
    expect(within(panel).getByText("Daily Five streak").nextElementSibling).toHaveTextContent(
      "1 day",
    );
    const stored = JSON.parse(localStorage.getItem(RECORD_KEY)!);
    expect(stored).toMatchObject({ games: 1, lastDaily: "2026-10-09", streak: 1 });

    fireEvent.click(within(panel).getByRole("button", { name: "Reset record" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Yes, reset it" }));
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
    expect(within(panel).getByText("Games played").nextElementSibling).toHaveTextContent("0");
  });

  it("keeps the pin and explains the problem when a guess fails", async () => {
    const failing = (photos: CatalogPhoto[]): GameBackend => {
      const local = new LocalBackend(photos);
      return {
        kind: "api",
        startRound: () => local.startRound(),
        hint: (id) => local.hint(id),
        guess: () => Promise.reject(new Error("The game server answered 503. Try again.")),
      };
    };
    render(<Game {...bundledGame} start="daily" today={TODAY} backendFor={failing} />);
    const map = await mapReady();
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    act(() => map.click(10, 10));
    fireEvent.click(screen.getByRole("button", { name: "Guess here" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("503");
    expect(screen.getByRole("button", { name: "Guess here" })).toBeEnabled();
  });

  it("fetches only the five records it deals, and explains when they don't arrive", async () => {
    const asked: string[][] = [];
    render(
      <Game
        deck={bundledGame.deck}
        loadRecords={async (ids) => {
          asked.push(ids);
          throw new Error(LOAD_ERROR);
        }}
        start="daily"
        today={TODAY}
      />,
    );
    await mapReady();
    expect(await screen.findByRole("alert", {}, WAIT)).toHaveTextContent(LOAD_ERROR);
    expect(asked).toEqual([daily.map((p) => p.id)]);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
  });

  it("opens on a fresh game by default and remembers the photos it dealt", async () => {
    render(<Game {...bundledGame} />);
    await mapReady();
    expect(await screen.findByText("Fresh game", {}, WAIT)).toBeInTheDocument();
    const src = (await screen.findByRole("img")).getAttribute("src");
    const read = () => JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    await waitFor(() => expect(read()).toHaveLength(ROUNDS_PER_GAME), WAIT);
    const recent = read();
    const byId = new Map((catalog as CatalogPhoto[]).map((p) => [p.id, p]));
    expect(recent.map((id) => byId.get(id)!.imageUrl)).toContain(src);
    expect(window.location.search).toBe("");
  });

  it("never deals a photo the browser played in the last game", async () => {
    const first = render(<Game {...bundledGame} />);
    await mapReady();
    await screen.findByText("Fresh game", {}, WAIT);
    await waitFor(() => expect(localStorage.getItem(RECENT_KEY)).not.toBeNull(), WAIT);
    const before = JSON.parse(localStorage.getItem(RECENT_KEY)!) as string[];
    first.unmount();

    render(<Game {...bundledGame} />);
    await mapReady();
    await screen.findByText("Fresh game", {}, WAIT);
    // The deal is saved in an effect after the title renders; with a bigger catalog that can
    // land a beat later, so wait for it rather than read storage once.
    const read = () => JSON.parse(localStorage.getItem(RECENT_KEY)!) as string[];
    await waitFor(() => expect(read()).toHaveLength(2 * ROUNDS_PER_GAME), WAIT);
    const after = read();
    const dealt = after.slice(-ROUNDS_PER_GAME);
    for (const id of dealt) expect(before).not.toContain(id);
  });

  it("opens the Daily Five from ?daily, and the header button switches modes", async () => {
    window.history.replaceState(null, "", "/?daily");
    render(<Game {...bundledGame} today={TODAY} />);
    await mapReady();
    expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole("img")).toHaveAttribute("src", daily[0].imageUrl);

    fireEvent.click(screen.getByRole("button", { name: "New random game" }));
    expect(await screen.findByText("Fresh game", {}, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: "Play the Daily Five" }));
    expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?daily"));
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
  });

  it("offers a fresh game after the Daily Five, and the Daily Five after a fresh game", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    const map = await mapReady();
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const card = await playRound(map, { lng: 0, lat: 0 });
      fireEvent.click(
        within(card).getByRole("button", { name: /^(Next photo|See your results)$/ }),
      );
    }
    await screen.findByRole("button", { name: "Play a fresh game" }, WAIT);
    expect(screen.queryByRole("button", { name: "Play the Daily Five" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    expect(await screen.findByText("Fresh game", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();

    // The summary unmounted the globe, so the second game plays on a new map.
    const second = await mapReady();
    expect(second).not.toBe(map);
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const card = await playRound(second, { lng: 0, lat: 0 });
      fireEvent.click(
        within(card).getByRole("button", { name: /^(Next photo|See your results)$/ }),
      );
    }
    fireEvent.click(await screen.findByRole("button", { name: "Play the Daily Five" }, WAIT));
    expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
  });

  it("holds the photo's place with a still blur of its own thumbnail, never a spinner", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    await mapReady();
    const img = await screen.findByRole("img", {}, WAIT);
    const frame = img.closest(".wb-photo")!;
    const holder = frame.querySelector("[data-photo-placeholder]")!;
    expect(holder).toHaveAttribute("data-photo-placeholder", "showing");
    expect(holder).toHaveAttribute("aria-hidden", "true");
    expect(holder.querySelector("img")).toHaveAttribute(
      "src",
      daily[0].imageUrl.replace(/\/\d+px-([^/]*)$/, "/60px-$1"),
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector(".wb-shimmer")).toBeNull();
    fireEvent.load(img);
    expect(holder).toHaveAttribute("data-photo-placeholder", "covered");
  });

  it("greets a first-time visitor over the photo until their first tap, then never again", async () => {
    const first = render(<Game {...bundledGame} start="daily" today={TODAY} />);
    await mapReady();
    expect(await screen.findByText(INTRO_TEXT.title, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByText(INTRO_TEXT.body)).toBeInTheDocument();

    // The tap that dismisses the card still reaches the photo: it zooms in.
    const photo = await screen.findByRole("button", { name: "Zoom in on the photo" }, WAIT);
    fireEvent.pointerDown(photo, { pointerId: 1 });
    expect(screen.queryByText(INTRO_TEXT.title)).toBeNull();
    expect(localStorage.getItem(INTRO_KEY)).toBe("1");
    fireEvent.pointerUp(photo, { pointerId: 1 });
    fireEvent.click(photo);
    expect(screen.getByRole("button", { name: "Zoom out of the photo" })).toBeInTheDocument();
    first.unmount();

    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    await mapReady();
    await screen.findByRole("button", { name: "Zoom in on the photo" }, WAIT);
    expect(screen.queryByText(INTRO_TEXT.title)).toBeNull();
  });

  it("dismisses the card from the globe too", async () => {
    render(<Game {...bundledGame} start="daily" today={TODAY} />);
    await mapReady();
    await screen.findByText(INTRO_TEXT.title, {}, WAIT);
    fireEvent.pointerDown(screen.getByRole("application", { name: /Globe/ }));
    expect(screen.queryByText(INTRO_TEXT.title)).toBeNull();
    expect(localStorage.getItem(INTRO_KEY)).toBe("1");
  });

  it("plays normally when browser storage throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      render(<Game {...bundledGame} start="daily" today={TODAY} />);
      const map = await mapReady();
      expect(await screen.findByText(INTRO_TEXT.title, {}, WAIT)).toBeInTheDocument();
      fireEvent.pointerDown(await screen.findByRole("button", { name: "Zoom in on the photo" }));
      expect(screen.queryByText(INTRO_TEXT.title)).toBeNull();
      const card = await playRound(map, daily[0]);
      expect(within(card).getByRole("heading", { name: daily[0].place })).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  describe("difficulty tiers", () => {
    const tiers = bundledGame.deck.tiers!;
    const srcToId = new Map((catalog as CatalogPhoto[]).map((p) => [p.imageUrl, p.id]));
    const shownId = async () =>
      srcToId.get((await screen.findByRole("img", {}, WAIT)).getAttribute("src")!);

    it("picking a tier next to the Daily Five deals a game from that third only", async () => {
      render(<Game {...bundledGame} today={TODAY} />);
      const map = await mapReady();
      await screen.findByText("Fresh game", {}, WAIT);
      const picker = screen.getByRole("combobox", {
        name: "Difficulty: how hard it was for Atlas",
      });
      expect(picker).toHaveValue("any");

      fireEvent.change(picker, { target: { value: "hard" } });
      expect(await screen.findByText("Hard game", {}, WAIT)).toBeInTheDocument();
      expect(screen.getByText(tierBlurb("hard", tiers))).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe("?tier=hard"));
      const read = () => JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
      await waitFor(() => expect(read().length).toBeGreaterThanOrEqual(2 * ROUNDS_PER_GAME), WAIT);
      for (const id of read().slice(-ROUNDS_PER_GAME)) expect(tiers.hard.ids).toContain(id);

      // Play it through: every round's photo is a Hard one, and the summary offers another.
      for (let i = 0; i < ROUNDS_PER_GAME; i++) {
        expect(tiers.hard.ids).toContain(await shownId());
        const card = await playRound(map, { lng: 0, lat: 0 });
        fireEvent.click(
          within(card).getByRole("button", { name: /^(Next photo|See your results)$/ }),
        );
      }
      fireEvent.click(await screen.findByRole("button", { name: "Play another Hard game" }, WAIT));
      expect(await screen.findByText("Hard game", {}, WAIT)).toBeInTheDocument();
      expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
    });

    it("opens a tier from ?tier=, and Any level goes back to the whole catalog", async () => {
      window.history.replaceState(null, "", "/?tier=easy");
      render(<Game {...bundledGame} today={TODAY} />);
      await mapReady();
      expect(await screen.findByText("Easy game", {}, WAIT)).toBeInTheDocument();
      expect(tiers.easy.ids).toContain(await shownId());

      fireEvent.change(screen.getByRole("combobox", { name: /Difficulty/ }), {
        target: { value: "any" },
      });
      expect(await screen.findByText("Fresh game", {}, WAIT)).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe(""));

      fireEvent.click(screen.getByRole("button", { name: "Play the Daily Five" }));
      expect(await screen.findByText("Daily Five, October 9", {}, WAIT)).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe("?daily"));
    });

    it("ignores a tier the URL makes up", async () => {
      window.history.replaceState(null, "", "/?tier=impossible");
      render(<Game {...bundledGame} today={TODAY} />);
      await mapReady();
      expect(await screen.findByText("Fresh game", {}, WAIT)).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe(""));
    });

    it("has no picker when the API server deals the photos", async () => {
      const api = new LocalBackend(daily);
      render(
        <Game {...bundledGame} apiUrl="http://api.test" backendFor={() => api} today={TODAY} />,
      );
      await mapReady();
      await screen.findByText("Fresh game", {}, WAIT);
      expect(screen.queryByRole("combobox", { name: /Difficulty/ })).toBeNull();
    });
  });
});
