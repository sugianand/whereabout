import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countryName } from "@/lib/countries";
import { CLOSE_DAILY_KEY, dailyCloseSeed, loadCloseDay } from "@/lib/game/closeDaily";
import { encodeCloseChallenge } from "@/lib/game/closeChallenge";
import { BEST_CLOSE_KEY, dealClose } from "@/lib/game/closeUp";
import type { GameRecord } from "@/lib/game/deck";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { nameIds, nameOptions, nameSeed } from "@/lib/game/nameCountry";
import { gameFor } from "@/test/deck";

import CloseUp from "./CloseUp";

function record(id: string, country: string, atlas: AtlasGuess | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
    width: 4000,
    height: 3000,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return { photo, atlas };
}

function atlasSays(country: string, p: number): AtlasGuess {
  return {
    lng: 10,
    lat: 45,
    confidence: p,
    topCountries: [{ country, p }],
    belief: { [country]: p },
    clues: [],
  };
}

const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", atlasSays("FR", 0.62))),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", atlasSays("XA", 0.9))),
  record("j5", "JP", null),
];
const BY_ID = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect);
});

async function setup(loadFocus: (url: string) => Promise<null | { x: number; y: number }>) {
  const game = gameFor(RECORDS);
  const { container } = render(
    <CloseUp
      deck={game.deck}
      loadRecords={game.loadRecords}
      random={() => 0.5}
      loadFocus={loadFocus}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled(), {
    timeout: 5000,
  });
  const photoId = () => container.querySelector("main")!.getAttribute("data-photo")!;
  const truth = () => BY_ID.get(photoId())!.photo.country;
  return { truth, photoId };
}

const noFocus = async () => null;
const option = (country: string) =>
  screen.getByRole("button", { name: new RegExp(countryName(country)) });
const names = () =>
  [1, 2, 3, 4].map((n) => screen.getByTestId(`close-option-${n}`).dataset.country!);

describe("Close-up", () => {
  it("zooms out with each wrong name and rules it out, and pays less for it", async () => {
    const { truth } = await setup(noFocus);
    expect(screen.getByText("Worth 3 points")).toBeInTheDocument();
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "0");
    const scale = () =>
      Number(/scale\(([\d.]+)\)/.exec(screen.getByTestId("close-photo").style.transform)![1]);
    const tight = scale();

    const wrong = names().find((c) => c !== truth())!;
    fireEvent.click(option(wrong));
    expect(option(wrong)).toBeDisabled();
    expect(screen.getByText("Worth 2 points")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Not ${countryName(wrong)}`);
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "1");
    expect(scale()).toBeLessThan(tight);

    fireEvent.click(option(truth()));
    expect(screen.getByRole("heading", { name: /^Right/ })).toBeInTheDocument();
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "whole");
    expect(screen.getByText(/^2 points, after 1 wrong\./)).toBeInTheDocument();
  });

  it("ends a photo on the third wrong name, naming the answer", async () => {
    const { truth } = await setup(noFocus);
    for (const c of names().filter((c) => c !== truth())) fireEvent.click(option(c));
    expect(
      screen.getByRole("heading", { name: `Out of tries: ${countryName(truth())}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^No points on this one\./)).toBeInTheDocument();
  });

  it("says what Atlas would have done, with the whole photo in front of it", async () => {
    const { truth } = await setup(noFocus);
    fireEvent.click(option(truth()));
    expect(
      screen.getByText(/Atlas, with the whole photo, would have|Atlas sat this one out/),
    ).toBeInTheDocument();
  });

  it("plays five photos to a score, keeps the best and deals again", async () => {
    const { truth } = await setup(noFocus);
    for (let i = 1; i <= 5; i++) {
      await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled());
      expect(screen.getByText(`Photo ${i} of 5`)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: String(names().indexOf(truth()) + 1) });
      fireEvent.click(
        screen.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }),
      );
    }
    expect(screen.getByRole("heading", { name: "15 of 15 points" })).toBeInTheDocument();
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLOSE_KEY)).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(screen.getByText("Photo 1 of 5")).toBeInTheDocument());
  });

  it("opens the crop on the busiest spot when it can be read, and asks for a thumbnail once", async () => {
    const loadFocus = vi.fn(async () => ({ x: 1, y: 0 }));
    await setup(loadFocus);
    expect(loadFocus).toHaveBeenCalledTimes(1);
    // Hard against the photo's right edge, and level with its top.
    expect(screen.getByTestId("close-photo").style.transform).toMatch(/translate\(-[\d.]+px, 0px\)/);
  });

  it("still deals when the spot can't be read", async () => {
    await setup(() => Promise.reject(new Error("no CORS")));
    expect(screen.getByTestId("close-photo")).toBeInTheDocument();
  });
});

describe("today's Close-up", () => {
  const DAY = "2026-11-07";
  const now = () => new Date(`${DAY}T10:30:00Z`);

  async function today() {
    const game = gameFor(RECORDS);
    const view = render(
      <CloseUp
        deck={game.deck}
        loadRecords={game.loadRecords}
        loadFocus={noFocus}
        daily
        now={now}
      />,
    );
    const photoId = () => view.container.querySelector("main")!.getAttribute("data-photo");
    const truth = () => BY_ID.get(photoId()!)!.photo.country;
    const hand = dealClose(nameIds(game.deck.streakIds, game.deck.regions), dailyCloseSeed(DAY));
    return { ...view, photoId, truth, hand };
  }

  const ready = () =>
    waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled(), { timeout: 5000 });

  it("deals the day's first photo, and links to the free games", async () => {
    const { photoId, hand } = await today();
    await ready();
    expect(photoId()).toBe(hand[0]);
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/close-up");
    expect(screen.queryByText("Best")).toBeNull();
  });

  it("keeps a wrong name as it is tapped, so a reload opens on the wider crop", async () => {
    const first = await today();
    await ready();
    const wrong = names().find((c) => c !== first.truth())!;
    fireEvent.click(option(wrong));
    expect(loadCloseDay(DAY)).toEqual({ results: [], wrong: [wrong] });
    first.unmount();

    const again = await today();
    await ready();
    expect(again.photoId()).toBe(again.hand[0]);
    expect(option(wrong)).toBeDisabled();
    expect(screen.getByText("Worth 2 points")).toBeInTheDocument();
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "1");
  });

  it("ends on the day's result, kept from the free games' best, and never deals it again", async () => {
    const { unmount, truth } = await today();
    for (let i = 1; i <= 5; i++) {
      await ready();
      fireEvent.click(option(truth()));
      expect(loadCloseDay(DAY)?.results).toHaveLength(i);
      fireEvent.click(screen.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }));
    }
    expect(
      await screen.findByRole("heading", { level: 1, name: "15 of 15 points" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^5 of 5 named from the tightest crop\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(localStorage.getItem(BEST_CLOSE_KEY)).toBeNull();
    expect(localStorage.getItem(CLOSE_DAILY_KEY)).not.toBeNull();

    unmount();
    await today();
    expect(
      await screen.findByRole("heading", { level: 1, name: "15 of 15 points" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("close-option-1")).toBeNull();
  });
});

describe("a friend's Close-up challenge", () => {
  const IDS = ["j3", "e1", "j1", "e4", "e2"];
  const SEED = 987_654_321;
  const FRIEND = [3, 2, 0, 1, 3];

  afterEach(() => window.history.replaceState(null, "", "/"));

  async function linked(value: string) {
    window.history.replaceState(null, "", `/close-up?challenge=${value}&x=1`);
    const game = gameFor(RECORDS);
    const view = render(
      <CloseUp
        deck={game.deck}
        loadRecords={game.loadRecords}
        random={() => 0.5}
        loadFocus={noFocus}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled(), {
      timeout: 5000,
    });
    const photoId = () => view.container.querySelector("main")!.getAttribute("data-photo")!;
    return { game, photoId, truth: () => BY_ID.get(photoId())!.photo.country };
  }

  it("deals the friend's photos and names, says the points to beat, and answers with yours", async () => {
    const value = encodeCloseChallenge({ ids: IDS, seed: SEED, points: FRIEND });
    const { game, photoId, truth } = await linked(value);
    expect(screen.getByText("A friend's challenge: 9 points to beat")).toBeInTheDocument();

    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled());
      expect(photoId()).toBe(IDS[i]);
      // The very names the friend had: the link's seed settles them.
      const want = nameOptions(truth(), game.deck.countryPool, nameSeed(SEED, IDS[i]));
      expect(names()).toEqual(want);
      if (i === 0) fireEvent.click(option(names().find((c) => c !== truth())!));
      fireEvent.click(option(truth()));
      expect(screen.getByText(new RegExp(`Your friend: ${FRIEND[i]} points?\\.`))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: i === 4 ? "See the score" : "Next photo" }));
    }

    // 14 to the friend's 9; a challenge's photos may be known, so it isn't a best.
    expect(screen.getByRole("heading", { name: "14 of 15 points" })).toBeInTheDocument();
    expect(screen.getByText(/^You won the challenge by 5 points\. Your friend scored 9\./)).toBeInTheDocument();
    expect(screen.getByText("2 of 3, friend 3")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLOSE_KEY)).toBeNull();

    let sent = "";
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (sent = t) },
      configurable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText("Challenge link copied. Whoever opens it plays these five crops."),
      ).toBeInTheDocument(),
    );
    expect(sent.split("\n")).toEqual([
      "Whereabout · Close-up: I named these five crops for 14 of 15 points.",
      "That beats your 9. Your turn to beat mine.",
      `http://localhost:3000/close-up?challenge=${IDS.join(".")}_${SEED.toString(36)}_2.3.3.3.3`,
    ]);

    // A fresh game leaves the link behind.
    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    await waitFor(() => expect(screen.getByText("Close-up: which country is this?")).toBeInTheDocument());
    expect(window.location.search).toBe("?x=1");
  });

  it("deals a fresh game, and says why, when the link is cut short or its photos have gone", async () => {
    await linked("j3.e1.j1_1z_3.2.0");
    expect(screen.getByText(/That challenge link was cut short/)).toBeInTheDocument();
    expect(screen.getByText("Close-up: which country is this?")).toBeInTheDocument();
    expect(window.location.search).toBe("?x=1");
    cleanup();

    await linked(encodeCloseChallenge({ ids: ["j3", "e1", "j1", "e4", "gone"], seed: 1, points: FRIEND }));
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeInTheDocument();
  });

  it("offers a challenge from the end of a free game, carrying its photos and points", async () => {
    const { photoId, truth } = await setup(noFocus);
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled());
      ids.push(photoId());
      fireEvent.click(option(truth()));
      fireEvent.click(screen.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }));
    }
    let sent = "";
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (sent = t) },
      configurable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(sent).not.toBe(""));
    const seed = Math.floor(0.5 * 2 ** 32);
    expect(sent).toContain("Same photos, same names: can you beat me?");
    expect(sent).toMatch(
      new RegExp(`/\\?challenge=${ids.join("\\.")}_${seed.toString(36)}_3\\.3\\.3\\.3\\.3$`),
    );
  });
});
