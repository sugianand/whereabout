import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { WAY_DAILY_KEY, dailyWayOrder } from "@/lib/game/wayDaily";
import { BEST_WAY_KEY, POINT_NAMES, initialBearing, pointOf } from "@/lib/game/whichWay";
import { stubCanvas } from "@/test/canvas";
import { gameFor } from "@/test/deck";
import { FakeMap, FakeMarker, resetFakes } from "@/test/maplibre-mock";

import WhichWay from "./WhichWay";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function record(
  id: string,
  lng: number,
  lat: number,
  atlas: { lng: number; lat: number } | null,
): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng,
    lat,
    place: `Place ${id}`,
    country: "FR",
    credit: { author: `Author ${id}`, license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas: atlas && { ...atlas, confidence: 0.5, topCountries: [], clues: [] },
  };
}

// random() = 0 shuffles with seed 0, which deals p5, p3, p4, p1, p2: London, Paris, a Paris
// suburb (one city with Paris, so it is dealt again), Tokyo, New York.
const RECORDS = [
  record("p1", 139.69, 35.69, null),
  record("p2", -74.01, 40.71, { lng: -80, lat: 40 }),
  record("p3", 2.35, 48.86, { lng: 2.3, lat: 48.8 }),
  record("p4", 2.45, 48.9, null),
  record("p5", -0.13, 51.51, { lng: -0.1, lat: 51.5 }),
];

beforeEach(() => {
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<WhichWay deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(point("south-east")).toBeEnabled());
  return { loadRecords };
}

const point = (name: string) => screen.getByRole("button", { name: `Headed ${name}` });
const photo = (n: number) => screen.getByTestId(`way-photo-${n}`);
const card = () => screen.getByRole("region");

describe("WhichWay", () => {
  it("deals where you stand and where you're headed, with no place until a pick", async () => {
    const { loadRecords } = await setup();
    expect(photo(1)).toHaveAttribute("data-photo", "p5");
    expect(photo(2)).toHaveAttribute("data-photo", "p3");
    expect(photo(1)).toHaveTextContent("You are here");
    expect(photo(2)).toHaveTextContent("You're headed here");
    expect(screen.queryByText(/Place p/)).toBeNull();
    // Eight points, each with its number-pad key.
    const compass = screen.getByRole("group", { name: "Which way from photo 1 to photo 2?" });
    expect(within(compass).getAllByRole("button")).toHaveLength(8);
    expect(point("north")).toHaveAttribute("aria-keyshortcuts", "8");
    expect(point("south-west")).toHaveAttribute("aria-keyshortcuts", "1");
    // The globe waits, out of reach, until the reveal.
    expect(screen.getByTestId("way-globe")).toHaveAttribute("inert");
    expect(loadRecords.mock.calls.flat(2)).toEqual(["p5", "p3", "p4"]);
  });

  it("reveals the route, the bearing and Atlas's pick, then travels on past an unfit stop", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    const region = await screen.findByRole("region");
    expect(within(region).getByRole("heading")).toHaveTextContent("Right");
    expect(region).toHaveTextContent(
      /Place p3 is south-east of Place p5: the shortest route sets off at 148°, [\d,]+ (km|mi) away\./,
    );
    expect(region).toHaveTextContent(
      "Atlas picked south-east and got it. Atlas this run: 1 of 1 stop.",
    );
    // Both photos stay credited with the photos out of view.
    expect(
      within(region).getByRole("link", { name: "Photo 1: Author p5, CC BY 4.0" }),
    ).toHaveAttribute("href", "https://c/p5");
    expect(screen.getByTestId("way-globe")).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("way-compass")).toBeNull();
    expect(screen.getByText("Streak").nextElementSibling).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_WAY_KEY)).toBe("1");

    fireEvent.click(within(region).getByRole("button", { name: "Travel on" }));
    // Paris is where you stand now; the suburb is one city with it, so Tokyo is dealt instead.
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p1"));
    expect(photo(1)).toHaveAttribute("data-photo", "p3");
    await waitFor(() => expect(point("north-east")).toBeEnabled());
  });

  it("teaches the great circle: Paris to Tokyo looks east on a map but sets off north-east", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p1"));
    await waitFor(() => expect(point("north-east")).toBeEnabled());
    // 9 is north-east on the number pad.
    fireEvent.keyDown(window, { key: "9" });
    const region = await screen.findByRole("region");
    expect(within(region).getByRole("heading")).toHaveTextContent("Right");
    expect(region).toHaveTextContent(
      "On a flat map it looks east, but the globe's shortest route heads north-east.",
    );
    // Atlas never guessed Tokyo, so it sits this stop out.
    expect(region).not.toHaveTextContent(/Atlas picked/);
  });

  it("ends the run on the first wrong pick and keeps the best", async () => {
    await setup();
    fireEvent.click(point("south-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(point("north-east")).toBeEnabled());
    fireEvent.click(point("north-east"));
    fireEvent.click(await screen.findByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(photo(2)).toHaveAttribute("data-photo", "p2"));
    await waitFor(() => expect(point("south")).toBeEnabled());
    fireEvent.click(point("south"));
    expect(within(card()).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card()).toHaveTextContent("You picked south.");
    expect(card()).toHaveTextContent("Run over: 2 stops in a row. That's your new best!");
    expect(localStorage.getItem(BEST_WAY_KEY)).toBe("2");

    fireEvent.click(within(card()).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(point("south-east")).toBeEnabled());
    expect(screen.getByText("Streak").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("2");
  });

  it("draws the route on the globe at the reveal: pin 1 where you stood, gold where you were headed", async () => {
    await setup();
    await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));
    fireEvent.click(point("south-east"));
    await screen.findByRole("region");
    // Reduced motion (matchMedia matches): the whole route is drawn at once.
    await waitFor(() => expect(map.jumpToCalls.length).toBeGreaterThan(0));
    const lines = map.sources.reveal.data as {
      features: { geometry: { coordinates: [number, number][] } }[];
    };
    expect(lines.features).toHaveLength(1);
    const route = lines.features[0].geometry.coordinates;
    expect(route[0][0]).toBeCloseTo(-0.13, 6);
    expect(route[0][1]).toBeCloseTo(51.51, 6);
    expect(route.at(-1)![0]).toBeCloseTo(2.35, 6);
    expect(route.at(-1)![1]).toBeCloseTo(48.86, 6);
    const placed = FakeMarker.instances.filter((m) => m.map === map);
    expect(placed.find((m) => m.element.textContent === "1")?.lngLat).toEqual([-0.13, 51.51]);
    expect(placed.find((m) => m.element.classList.contains("globe-pin--truth"))?.lngLat).toEqual([
      2.35, 48.86,
    ]);
  });
});

describe("WhichWay, today's run", () => {
  // Five cities on four continents, every pair far enough apart to make a fair question.
  const CITIES: Record<string, [number, number]> = {
    d1: [-0.13, 51.51], // London
    d2: [139.69, 35.69], // Tokyo
    d3: [-74.01, 40.71], // New York
    d4: [18.42, -33.92], // Cape Town
    d5: [151.21, -33.87], // Sydney
  };
  const DAILY = Object.entries(CITIES).map(([id, [lng, lat]]) =>
    record(id, lng, lat, { lng: lng + 0.5, lat }),
  );
  const DAY = "2026-10-31";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyWayOrder(Object.keys(CITIES), DAY);
  const ll = (id: string) => ({ lng: CITIES[id][0], lat: CITIES[id][1] });
  /** The point really heading from the stop at `i` to the next one. */
  const truth = (i: number) => POINT_NAMES[pointOf(initialBearing(ll(order[i]), ll(order[i + 1])))];
  /** A point opposite the truth, so always wrong. */
  const wrong = (i: number) =>
    POINT_NAMES[pointOf(initialBearing(ll(order[i]), ll(order[i + 1])) + 180)];

  function play() {
    const game = gameFor(DAILY);
    return render(<WhichWay deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
  }

  it("deals the day's journey, picks it back up after a reload, and ends on a miss", async () => {
    const first = play();
    await waitFor(() => expect(point("north")).toBeEnabled());
    expect(photo(1)).toHaveAttribute("data-photo", order[0]);
    expect(photo(2)).toHaveAttribute("data-photo", order[1]);
    expect(screen.getByText(/today's run \(2026-10-31\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free runs" })).toHaveAttribute("href", "/which-way");
    expect(screen.queryByText("Best")).toBeNull();
    fireEvent.click(point(truth(0)));
    await screen.findByRole("button", { name: "Travel on" });
    expect(JSON.parse(localStorage.getItem(WAY_DAILY_KEY)!)[DAY]).toMatchObject({
      streak: 1,
      ended: null,
      at: order[1],
    });
    first.unmount();

    // A reload carries on from where the right pick took you, with the streak so far.
    play();
    await waitFor(() => expect(point("north")).toBeEnabled());
    expect(photo(1)).toHaveAttribute("data-photo", order[1]);
    expect(photo(2)).toHaveAttribute("data-photo", order[2]);
    expect(screen.getByText("Streak").nextElementSibling).toHaveTextContent("1");

    fireEvent.click(point(wrong(1)));
    const region = await screen.findByRole("region");
    expect(within(region).getByRole("heading")).toHaveTextContent("Wrong");
    expect(region).toHaveTextContent("Today's run is over: 1 stop in a row.");
    expect(within(region).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(region).getByRole("link", { name: "Play a free run" })).toHaveAttribute(
      "href",
      "/which-way",
    );
    const kept = JSON.parse(localStorage.getItem(WAY_DAILY_KEY)!)[DAY];
    expect(kept).toMatchObject({ streak: 1, atlasPlayed: 2, ended: "miss" });
    // Today's run keeps its own result, apart from the free runs' best.
    expect(localStorage.getItem(BEST_WAY_KEY)).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(region).getByRole("button", { name: "Share today's run" }));
    expect(await within(region).findByText("Result copied. Paste it anywhere.")).toBeVisible();
    expect(writeText.mock.calls[0][0]).toMatch(
      new RegExp(
        `^Whereabout · Which way\\? · 2026-10-31\\n🧭 1 stop in a row\\n🟩🟥\\nAtlas: ${kept.atlasRight} of 2\\n`,
      ),
    );
  });

  it("shows the day's result instead of dealing it again once it has ended", async () => {
    localStorage.setItem(
      WAY_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 4, atlasRight: 1, atlasPlayed: 3, ended: "miss" } }),
    );
    play();
    expect(await screen.findByRole("heading", { name: "4 stops in a row" })).toBeInTheDocument();
    expect(
      screen.getByText(/Atlas got 1 of the 3 stops it played\. The next run is dealt in 5h 12m\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.queryByRole("group", { name: /Which way from photo 1/ })).toBeNull();
  });

  it("links free runs to today's run", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/which-way/daily",
    );
  });
});

describe("a friend's Which way? challenge", () => {
  // The friend went London to Paris (south-east, right), then set off south from Paris toward
  // Tokyo, which heads north-east.
  const FRIEND = "p5.p3.p1_5_1_S";
  const AT = Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.photo]));
  const shown = (n: number) => photo(n).getAttribute("data-photo")!;
  /** The point really heading from photo 1 to photo 2 on screen, and one opposite it. */
  const heading = () => initialBearing(AT[shown(1)], AT[shown(2)]);

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
    window.history.replaceState(null, "", `/which-way?challenge=${value}&x=1`);
    const game = gameFor(RECORDS);
    render(<WhichWay deck={game.deck} loadRecords={game.loadRecords} random={() => 0} />);
    await waitFor(() => expect(point("north")).toBeEnabled());
  }

  it("deals the friend's journey, shows the way they set off where it ended, plays on, and answers", async () => {
    await linked(FRIEND);
    expect(screen.getByText("A friend's challenge: 1 stop in a row to beat")).toBeVisible();
    expect([shown(1), shown(2)]).toEqual(["p5", "p3"]);
    fireEvent.click(point("south-east"));
    expect(card()).not.toHaveTextContent("Your friend's run ended here");
    expect(screen.queryByTestId("way-dial-friend")).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(point("north")).toBeEnabled());

    // The stop that ended the friend's run, its pick shown only once you have picked.
    expect([shown(1), shown(2)]).toEqual(["p3", "p1"]);
    expect(screen.queryByText(/Your friend's run ended here/)).toBeNull();
    fireEvent.click(point("north-east"));
    expect(card()).toHaveTextContent("That beats your friend's 1 in a row!");
    expect(card()).toHaveTextContent("Your friend's run ended here: they set off south.");
    expect(screen.getByTestId("way-dial-friend")).toBeInTheDocument();

    // Past the friend's photos, the rest of the deck from their seed: set off the wrong way.
    fireEvent.click(within(card()).getByRole("button", { name: "Travel on" }));
    await waitFor(() => expect(point("north")).toBeEnabled());
    const next = shown(2);
    expect(["p2", "p4"]).toContain(next);
    const wrong = pointOf(heading() + 180);
    fireEvent.click(point(POINT_NAMES[wrong]));
    expect(card()).toHaveTextContent(
      "Run over: 2 stops in a row. You beat your friend's 1 in a row by 1.",
    );
    expect(card()).not.toHaveTextContent("Your friend's run ended here");
    // A challenge's photos may have been seen, so it is played for the friend only.
    expect(localStorage.getItem(BEST_WAY_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(card()).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it travels the same journey, stop by stop.",
        ),
      ).toBeInTheDocument(),
    );
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Which way?: I travelled 2 stops in a row.",
      "That beats your 1. Your turn to travel further.",
      `http://localhost:3000/which-way?challenge=p5.p3.p1.${next}_5_2_${wrong}`,
    ]);

    // The head to head is drawn call by call, saved, and the reply link copied beside it.
    const drawn = stubCanvas();
    const reply = box.sent;
    box.sent = "";
    fireEvent.click(within(card()).getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeInTheDocument();
    expect(drawn.saved).toEqual(["whereabout-which-way-head-to-head.png"]);
    expect(drawn.words).toEqual(expect.arrayContaining([
      "Which way?: head to head",
      "You won",
      "2 in a row",
      "1 in a row",
      "Stop 1",
      "Stop 3",
      "Right",
      "Wrong",
    ]));
    const all = drawn.words.join("\n");
    for (const id of ["p5", "p3", "p1", next]) expect(all).not.toContain(id);
    expect(box.sent).toBe(reply);
    drawn.restore();

    // A fresh run leaves the link behind.
    fireEvent.click(within(card()).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(screen.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible(),
    );
    expect(window.location.search).toBe("?x=1");
  });

  it("says when a link is cut short or its photos have gone, and deals a fresh run", async () => {
    await linked("p5.p3_5_0");
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(screen.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
    expect(window.location.search).toBe("?x=1");
    cleanup();
    await linked("p5.gone_5_0_N");
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });

  it("offers a challenge from the end of a free run, carrying the photos and the wrong pick", async () => {
    await setup();
    // Seed 0 deals p5, p3: London to Paris heads south-east, so north is wrong.
    fireEvent.click(point("north"));
    const box = clipboard();
    fireEvent.click(within(card()).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent).toContain("I travelled 0 stops in a row.");
    expect(box.sent.split("\n").at(-1)).toBe("http://localhost:3000/?challenge=p5.p3_0_0_N");
  });
});
