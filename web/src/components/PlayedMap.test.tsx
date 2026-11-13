import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GLOBE_PALETTES, MAP_COLORS } from "@/lib/basemap";
import { MIN_SEPARATION, contrastRatio, separations } from "@/lib/colorVision";
import { BANDS, PLAYED_KEY, type PlayedPhoto } from "@/lib/playedMap";
import { setTheme } from "@/lib/theme";
import { stubColorScheme } from "@/test/colorScheme";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import PlayedMap, {
  BAND_COLORS,
  DAY_BAND_COLORS,
  LIST_FIRST,
  MARK_EDGE,
  MARK_EDGES,
  RING_COLORS,
} from "./PlayedMap";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const DAY_MAP_COLORS = GLOBE_PALETTES.day;

function photo(id: string, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: `Place ${id}`,
    country: "FR",
    km: 120,
    score: 4600,
    day: "2026-10-30",
    ...over,
  };
}

function store(history: PlayedPhoto[]) {
  window.localStorage.setItem(PLAYED_KEY, JSON.stringify(history));
}

beforeEach(() => {
  resetFakes();
  window.localStorage.clear();
});
afterEach(() => {
  act(() => setTheme("system"));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PlayedMap", () => {
  it("asks for a first game when nothing has been played, and draws no globe", async () => {
    render(<PlayedMap />);
    expect(await screen.findByText(/Nothing on your map yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/");
    expect(FakeMap.instances).toHaveLength(0);
  });

  it("puts every played photo on the globe and counts what you've seen", async () => {
    store([
      photo("a", { country: "JP", km: 8, lng: 139.7, lat: 35.7, place: "Shibuya, Tokyo" }),
      photo("b", { country: "FR", km: 1200 }),
      photo("c", { country: "JP", km: null, score: 0 }),
    ]);
    render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));

    const dots = map.sources.played.data as { features: { properties: { band: string } }[] };
    expect(dots.features.map((f) => f.properties.band)).toEqual(["bullseye", "near", "far"]);

    const numbers = screen.getByLabelText("Your map in numbers");
    expect(within(numbers).getByText("Photos").nextSibling).toHaveTextContent("3");
    expect(within(numbers).getByText("Countries").nextSibling).toHaveTextContent("2");
    expect(within(numbers).getByText("Continents").nextSibling).toHaveTextContent("2");
    expect(screen.getByText(/Within 25 km/)).toHaveTextContent("Within 25 km: 1");
    expect(screen.getByText(/Further, or no pin/)).toHaveTextContent("Further, or no pin: 1");

    const countries = within(screen.getByRole("list", { name: "Countries you've seen" }));
    expect(countries.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Japan×2",
      "France",
    ]);

    // Newest first; a round with no pin says so.
    const rounds = within(screen.getByRole("list", { name: "Your rounds" })).getAllByRole("button");
    expect(rounds[0]).toHaveTextContent("No pin · 0 points");
    expect(rounds[2]).toHaveTextContent("Shibuya, Tokyo");
    expect(rounds[2]).toHaveTextContent("8.0 km off · 4,600 points");
  });

  it("marks each band by shape as well as colour, on the globe, in the legend and in the list", async () => {
    store([
      photo("a", { km: 8 }),
      photo("b", { km: 300 }),
      photo("c", { km: 1200 }),
      photo("d", { km: null, score: 0 }),
    ]);
    const { container } = render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));

    // A picture per band for the globe's symbol layer, sharp at twice its size.
    expect(Object.keys(map.images)).toEqual(BANDS.map((b) => `played-mark-${b}`));
    for (const b of BANDS) {
      const { image, options } = map.images[`played-mark-${b}`];
      expect((image as { width: number }).width).toBe(40);
      expect(options).toEqual({ pixelRatio: 2 });
    }
    const dots = map.layers.find((l) => l.id === "played-dots") as unknown as {
      type: string;
      layout: Record<string, unknown>;
    };
    expect(dots.type).toBe("symbol");
    expect(dots.layout["icon-image"]).toEqual([
      "match",
      ["get", "band"],
      ...BANDS.flatMap((b) => [b, `played-mark-${b}`]),
      "played-mark-far",
    ]);
    expect(dots.layout["icon-allow-overlap"]).toBe(true);

    const legend = screen.getByRole("list", { name: "Closeness" });
    expect(
      Array.from(legend.querySelectorAll("svg")).map((svg) => svg.getAttribute("data-mark")),
    ).toEqual(["circle", "diamond", "triangle", "cross"]);
    // Newest first: no pin, 1,200 km, 300 km, 8 km.
    const rounds = within(screen.getByRole("list", { name: "Your rounds" }));
    expect(
      rounds.getAllByRole("button").map((b) => b.querySelector("svg")?.getAttribute("data-mark")),
    ).toEqual(["cross", "triangle", "diamond", "circle"]);
    expect(container.querySelectorAll("svg[aria-hidden='true'][data-mark]").length).toBe(8);
  });

  it("keeps the band colours apart for every kind of colour vision, and clear of the globe", () => {
    const palette = BANDS.map((b) => BAND_COLORS[b]);
    for (const s of separations(palette)) {
      expect(s.distance, `${s.kind}: ${s.pair.join(" and ")}`).toBeGreaterThanOrEqual(
        MIN_SEPARATION,
      );
    }
    // WCAG's 3:1 for graphics, on the page, the sea and the land, and against each mark's edge.
    for (const c of palette) {
      for (const under of [MAP_COLORS.ocean, MAP_COLORS.land, MARK_EDGE]) {
        expect(contrastRatio(c, under), `${c} on ${under}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the daylight bands apart too, and clear of the globe by day and the light page", () => {
    const palette = BANDS.map((b) => DAY_BAND_COLORS[b]);
    for (const s of separations(palette)) {
      expect(s.distance, `${s.kind}: ${s.pair.join(" and ")}`).toBeGreaterThanOrEqual(
        MIN_SEPARATION,
      );
    }
    // The light page's ocean token is where the legend and list draw them.
    const page = "#e9f0ee";
    for (const c of [...palette, RING_COLORS.day]) {
      for (const under of [DAY_MAP_COLORS.ocean, DAY_MAP_COLORS.land, MARK_EDGES.day, page]) {
        expect(contrastRatio(c, under), `${c} on ${under}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("draws the globe by day on a light page, with the daylight marks in the legend", async () => {
    stubColorScheme(true);
    store([photo("a", { km: 8 }), photo("b", { km: 6000 })]);
    const { container } = render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    const style = map.options.style as { layers: { id: string; paint?: object }[] };
    expect(style.layers.find((l) => l.id === "ocean")?.paint).toEqual({
      "background-color": DAY_MAP_COLORS.ocean,
    });
    act(() => map.emit("load"));
    expect(screen.getByTestId("played-globe")).toHaveAttribute("data-light", "day");
    expect(map.updatedImages).toEqual([]); // Built by day: nothing to repaint.
    const legend = within(screen.getByRole("list", { name: "Closeness" }));
    const fills = legend
      .getAllByRole("listitem")
      .map((li) => li.querySelector("circle, polygon")?.getAttribute("fill"));
    expect(fills).toEqual(BANDS.map((b) => DAY_BAND_COLORS[b]));
    expect(container.querySelector(`[fill="${BAND_COLORS.bullseye}"]`)).toBeNull();
  });

  it("repaints the globe in place when Colours turns the page light, then dark again", async () => {
    stubColorScheme(false);
    store([photo("a", { km: 8 }), photo("b", { km: 6000 })]);
    render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));
    const dots = map.sources.played.data;
    expect(screen.getByTestId("played-globe")).toHaveAttribute("data-light", "night");

    act(() => setTheme("light"));
    // At once, with no fade, in the same frame as the marks.
    expect(map.paint.ocean).toEqual({
      "background-color-transition": { duration: 0, delay: 0 },
      "background-color": DAY_MAP_COLORS.ocean,
    });
    expect(map.paint.land).toMatchObject({ "fill-color": DAY_MAP_COLORS.land });
    expect(map.sky).toMatchObject({ "sky-color": DAY_MAP_COLORS.space });
    expect(map.updatedImages).toEqual(BANDS.map((b) => `played-mark-${b}`));
    expect(map.paint["played-selected"]).toEqual({ "circle-stroke-color": RING_COLORS.day });
    // The same map, marks and data: nothing was rebuilt.
    expect(FakeMap.instances).toHaveLength(1);
    expect(map.removed).toBe(false);
    expect(map.sources.played.data).toBe(dots);
    expect(screen.getByTestId("played-globe")).toHaveAttribute("data-light", "day");

    act(() => setTheme("dark"));
    expect(map.paint.ocean).toMatchObject({ "background-color": MAP_COLORS.ocean });
    expect(map.paint["played-selected"]).toEqual({ "circle-stroke-color": RING_COLORS.night });
  });

  it("flies to a round picked from the list and rings it", async () => {
    store([photo("a", { lng: 139.7, lat: 35.7, place: "Tokyo" }), photo("b")]);
    render(<PlayedMap />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));

    fireEvent.click(screen.getByRole("button", { name: /Tokyo/ }));
    expect(screen.getByRole("button", { name: /Tokyo/ })).toHaveAttribute("aria-pressed", "true");
    expect(map.easeToCalls.at(-1)?.center).toEqual([139.7, 35.7]);
    const ring = map.sources["played-selected"].data as { features: unknown[] };
    expect(ring.features).toHaveLength(1);
  });

  it("lists the newest rounds first and the rest on request", async () => {
    store(Array.from({ length: LIST_FIRST + 3 }, (_, i) => photo(`p${i}`)));
    render(<PlayedMap />);
    const list = await screen.findByRole("list", { name: "Your rounds" });
    expect(within(list).getAllByRole("button")).toHaveLength(LIST_FIRST);
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent(`Place p${LIST_FIRST + 2}`);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${LIST_FIRST + 3}` }));
    expect(within(list).getAllByRole("button")).toHaveLength(LIST_FIRST + 3);
  });

  it("ignores a malformed stored history", async () => {
    window.localStorage.setItem(PLAYED_KEY, "{oops");
    render(<PlayedMap />);
    expect(await screen.findByText(/Nothing on your map yet/)).toBeInTheDocument();
  });
});
