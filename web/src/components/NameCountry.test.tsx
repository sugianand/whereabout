import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countryName } from "@/lib/countries";
import type { GameRecord } from "@/lib/game/deck";
import { encodeNameChallenge } from "@/lib/game/nameChallenge";
import { BEST_NAME_KEY, nameOptions, nameSeed } from "@/lib/game/nameCountry";
import { loadNameDay, rememberNameDay } from "@/lib/game/nameDaily";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import NameCountry from "./NameCountry";

function record(id: string, country: string, atlas: AtlasGuess | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
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

// Five French photos Atlas reads rightly, and five Japanese ones: j1 to j4 Atlas reads as Atlantis
// (a country on none of the four names), and j5 it never guessed.
const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", atlasSays("FR", 0.62))),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", atlasSays("XA", 0.9))),
  record("j5", "JP", null),
];
const BY_ID = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => localStorage.clear());

async function setup(random: () => number = () => 0.5) {
  const game = gameFor(RECORDS);
  const { container } = render(
    <NameCountry deck={game.deck} loadRecords={game.loadRecords} random={random} />,
  );
  await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled(), {
    timeout: 5000,
  });
  const photoId = () => container.querySelector("main")!.getAttribute("data-photo")!;
  return { photoId, truth: () => BY_ID.get(photoId())!.photo.country };
}

const option = (country: string) =>
  screen.getByRole("button", { name: new RegExp(countryName(country)) });
const streak = () => screen.getByText("Streak").nextElementSibling;
const wrongOf = (truth: string) =>
  [1, 2, 3, 4]
    .map((n) => screen.getByTestId(`name-option-${n}`).getAttribute("data-country")!)
    .find((c) => c !== truth)!;

describe("NameCountry", () => {
  it("offers four names from the photo's continent, and shows nothing of the answer", async () => {
    const { truth } = await setup();
    expect(option(truth())).toBeEnabled();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByText(/^Place /)).toBeNull();
  });

  it("a right tap counts, names the place and its continent, and deals the next photo", async () => {
    const { truth, photoId } = await setup();
    const first = photoId();
    const country = truth();
    fireEvent.click(option(country));
    const card = screen.getByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent(`Right: ${countryName(country)}`);
    expect(card).toHaveTextContent(`Place ${first}, ${country === "FR" ? "Europe" : "Asia"}`);
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_NAME_KEY)).toBe("1");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photoId()).not.toBe(first));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a wrong tap ends the run and shows the right name; a new run starts at 0", async () => {
    localStorage.setItem(BEST_NAME_KEY, "3");
    const { truth } = await setup();
    const country = truth();
    fireEvent.click(option(wrongOf(country)));
    const card = screen.getByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent(`Wrong: ${countryName(country)}`);
    expect(card).toHaveTextContent("Run over: 0 countries in a row. Your best is 3 countries.");
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(screen.getByTestId("name-option-1")).toBeEnabled());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("takes 1 to 4 from the keyboard, ignoring other keys", async () => {
    await setup();
    fireEvent.keyDown(window, { key: "5" });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("says what Atlas leaned to, or that it sat the photo out", async () => {
    // Each deal differs, so play until both kinds of photo have come up, restarting on a miss.
    const { truth } = await setup();
    const seen = new Set<string>();
    for (let i = 0; i < 10 && seen.size < 2; i++) {
      const country = truth();
      fireEvent.click(option(country));
      const card = screen.getByRole("region");
      if (country === "FR") {
        expect(card).toHaveTextContent(
          "Of these four, Atlas leaned most to France (62%), and got it.",
        );
        expect(within(option("FR")).getByText("Atlas")).toBeInTheDocument();
        seen.add("read");
      } else if (card.textContent?.includes("sat this one out")) {
        seen.add("sat out");
      }
      const next = within(card).getByRole("button", { name: "Next photo" });
      fireEvent.click(next);
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
    }
    expect(seen).toEqual(new Set(["read", "sat out"]));
  });

  it("says when every photo has been named", async () => {
    const game = gameFor(RECORDS.slice(0, 5));
    render(<NameCountry deck={game.deck} loadRecords={game.loadRecords} random={() => 0.5} />);
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
      fireEvent.click(option("FR"));
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    }
    expect(await screen.findByRole("heading", { name: "All 5 named" })).toBeInTheDocument();
  });

  it("explains itself with nothing to deal", async () => {
    const empty = gameFor([]);
    render(<NameCountry deck={empty.deck} loadRecords={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });

  describe("today's run", () => {
    const DAY = "2026-11-04";
    const now = () => new Date(`${DAY}T12:00:00Z`);

    async function daily() {
      const game = gameFor(RECORDS);
      const view = render(
        <NameCountry deck={game.deck} loadRecords={game.loadRecords} daily now={now} />,
      );
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled(), {
        timeout: 5000,
      });
      const shown = () => ({
        id: view.container.querySelector("main")!.getAttribute("data-photo")!,
        names: [1, 2, 3, 4].map((n) =>
          screen.getByTestId(`name-option-${n}`).getAttribute("data-country"),
        ),
      });
      return { ...view, shown };
    }
    const right = (id: string) => BY_ID.get(id)!.photo.country;

    it("deals the same photo and names again, and picks up after a right tap", async () => {
      const first = await daily();
      const opening = first.shown();
      first.unmount();

      const second = await daily();
      expect(second.shown()).toEqual(opening);
      fireEvent.click(option(right(opening.id)));
      expect(loadNameDay(DAY)).toMatchObject({ streak: 1, ended: null });
      second.unmount();

      const third = await daily();
      expect(streak()).toHaveTextContent("1");
      expect(third.shown().id).not.toBe(opening.id);
      expect(screen.queryByText("Best")).toBeNull();
    });

    it("ends on the first miss, keeps no free-run best, and offers the share", async () => {
      rememberNameDay(DAY, { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null });
      const { shown } = await daily();
      fireEvent.click(option(wrongOf(right(shown().id))));
      expect(await screen.findByText("Today's run is over: 1 country in a row.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Start a new run" })).toBeNull();
      expect(loadNameDay(DAY)?.ended).toBe("miss");
      expect(localStorage.getItem(BEST_NAME_KEY)).toBeNull();
    });

    it("shows a finished day instead of dealing it again", async () => {
      rememberNameDay(DAY, { streak: 4, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
      const game = gameFor(RECORDS);
      render(<NameCountry deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
      expect(await screen.findByRole("heading", { name: "4 countries in a row" })).toBeVisible();
      expect(screen.getByText(/Atlas got 2 of the 3 photos it played/)).toBeVisible();
      expect(screen.queryByTestId("name-option-1")).toBeNull();
    });

    it("marks a run that names the last photo as cleared, and shows the whole day", async () => {
      const count = RECORDS.length - 1;
      rememberNameDay(DAY, { streak: count, atlasRight: 0, atlasPlayed: 0, ended: null });
      const { shown } = await daily();
      fireEvent.click(option(right(shown().id)));
      expect(loadNameDay(DAY)?.ended).toBe("cleared");
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
      expect(await screen.findByRole("heading", { name: "You named every photo" })).toBeVisible();
    });
  });
});

describe("a friend's Name the country challenge", () => {
  const SEED = 987_654_321;
  // The friend named e3 and j2, and missed on e1.
  const FRIEND = { ids: ["e3", "j2", "e1"], seed: SEED, streak: 2 };

  afterEach(() => window.history.replaceState(null, "", "/"));

  function clipboard() {
    const box = { sent: "" };
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (box.sent = t) },
      configurable: true,
    });
    return box;
  }

  async function linked(value: string) {
    window.history.replaceState(null, "", `/name-country?challenge=${value}&x=1`);
    const game = gameFor(RECORDS);
    const view = render(
      <NameCountry deck={game.deck} loadRecords={game.loadRecords} random={() => 0.5} />,
    );
    await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled(), {
      timeout: 5000,
    });
    const photoId = () => view.container.querySelector("main")!.getAttribute("data-photo")!;
    const names = () =>
      [1, 2, 3, 4].map((n) => screen.getByTestId(`name-option-${n}`).getAttribute("data-country"));
    return { game, photoId, names, truth: () => BY_ID.get(photoId())!.photo.country };
  }

  it("deals the friend's photos and names, plays on past them, and answers with yours", async () => {
    const { game, photoId, names, truth } = await linked(encodeNameChallenge(FRIEND));
    expect(screen.getByText("A friend's challenge: 2 countries in a row to beat")).toBeVisible();
    expect(screen.queryByText("Best")).not.toBeNull();

    const played: string[] = [];
    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
      played.push(photoId());
      if (i < 3) {
        expect(photoId()).toBe(FRIEND.ids[i]);
        // The very names the friend had: the link's seed settles them.
        expect(names()).toEqual(
          nameOptions(truth(), game.deck.countryPool, nameSeed(SEED, FRIEND.ids[i])),
        );
      } else {
        // Past the friend's miss, the run goes on to photos the friend never saw.
        expect(FRIEND.ids).not.toContain(photoId());
      }
      if (i < 3) {
        fireEvent.click(option(truth()));
        const card = screen.getByRole("region");
        if (i === 2) expect(card).toHaveTextContent("That beats your friend's 2 in a row!");
        else expect(card).not.toHaveTextContent("That beats");
        fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
      } else {
        fireEvent.click(option(wrongOf(truth())));
      }
    }

    const card = screen.getByRole("region");
    expect(card).toHaveTextContent(
      "Run over: 3 countries in a row. You beat your friend's 2 in a row by 1.",
    );
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_NAME_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these photos, with these names.",
        ),
      ).toBeInTheDocument(),
    );
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Name the country: I named 3 countries in a row.",
      "That beats your 2. Your turn to go further.",
      `http://localhost:3000/name-country?challenge=${played.join(".")}_${SEED.toString(36)}_3`,
    ]);

    // A fresh run leaves the link behind.
    fireEvent.click(within(card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(screen.getByText("Name the country: which of these four?")).toBeInTheDocument(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when the friend's streak still wins", async () => {
    const { truth } = await linked(encodeNameChallenge(FRIEND));
    fireEvent.click(option(wrongOf(truth())));
    expect(screen.getByRole("region")).toHaveTextContent(
      "Run over: 0 countries in a row. Your friend's 2 in a row wins, by 2.",
    );
  });

  it("deals a fresh run, and says why, when the link is cut short or its photos have gone", async () => {
    await linked("e3.j2.e1_1z_7");
    expect(screen.getByText(/That challenge link was cut short/)).toBeInTheDocument();
    expect(screen.getByText("Name the country: which of these four?")).toBeInTheDocument();
    expect(window.location.search).toBe("?x=1");
    cleanup();

    await linked(encodeNameChallenge({ ...FRIEND, ids: ["e3", "j2", "gone"] }));
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, carrying the photos up to the miss", async () => {
    const { photoId, truth } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      ids.push(photoId());
      fireEvent.click(option(truth()));
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
    }
    ids.push(photoId());
    fireEvent.click(option(wrongOf(truth())));
    const box = clipboard();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    const seed = Math.floor(0.5 * 2 ** 32);
    expect(box.sent).toContain("Same photos, same names: can you go further?");
    expect(box.sent).toMatch(
      new RegExp(`/\\?challenge=${ids.join("\\.")}_${seed.toString(36)}_2$`),
    );
    // The new run stays the focused way on.
    expect(screen.getByRole("button", { name: "Start a new run" })).toBeInTheDocument();
  });

  it("offers a challenge from a run that named every photo", async () => {
    const game = gameFor(RECORDS.slice(0, 5));
    render(<NameCountry deck={game.deck} loadRecords={game.loadRecords} random={() => 0.5} />);
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
      fireEvent.click(option("FR"));
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    }
    await screen.findByRole("heading", { name: "All 5 named" });
    const box = clipboard();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).toMatch(/_5$/));
    expect(box.sent.split("\n").at(-1)!.split("=")[1].split("_")[0].split(".")).toHaveLength(5);
  });
});
