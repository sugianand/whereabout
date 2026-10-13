import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeMap, FakeMarker, resetFakes, workerUrls } from "@/test/maplibre-mock";
import type { LngLat } from "@/lib/geo";
import type { RevealLines, RevealView } from "@/lib/reveal";

import Globe from "./Globe";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function Harness({
  initial = null,
  disabled = false,
  reveal = null,
}: {
  initial?: LngLat | null;
  disabled?: boolean;
  reveal?: RevealView | null;
}) {
  const [pin, setPin] = useState<LngLat | null>(initial);
  return <Globe pin={pin} onPinChange={setPin} disabled={disabled} reveal={reveal} />;
}

async function renderGlobe(props: Parameters<typeof Harness>[0] = {}) {
  const view = render(<Harness {...props} />);
  await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
  const map = FakeMap.instances[0];
  act(() => map.emit("load"));
  return { ...view, map, globe: screen.getByRole("application") };
}

function marker() {
  return FakeMarker.instances.at(-1);
}

beforeEach(resetFakes);
afterEach(() => vi.clearAllMocks());

describe("Globe", () => {
  it("creates a globe-projection map with its own keyboard handling", async () => {
    const { map } = await renderGlobe();
    const style = map.options.style as { projection: { type: string } };
    expect(style.projection).toEqual({ type: "globe" });
    expect(map.options.keyboard).toBe(false);
    expect(workerUrls).toEqual(["/vendor/maplibre-gl-worker-6.13.0.mjs"]);
    expect(screen.getByText("Place your pin")).toBeInTheDocument();
  });

  it("places a pin where the player clicks and moves it on the next click", async () => {
    const { map } = await renderGlobe();

    act(() => map.click(2.3522, 48.8566));
    expect(screen.getByText("Your pin: 48.86° N, 2.35° E")).toBeInTheDocument();
    expect(marker()?.lngLat).toEqual([2.3522, 48.8566]);
    expect(marker()?.map).toBe(map);

    act(() => map.click(-43.2, -22.9));
    expect(screen.getByText("Your pin: 22.90° S, 43.20° W")).toBeInTheDocument();
    expect(FakeMarker.instances).toHaveLength(1);
    expect(marker()?.lngLat).toEqual([-43.2, -22.9]);
  });

  it("wraps clicks past the antimeridian into normal longitudes", async () => {
    const { map } = await renderGlobe();
    act(() => map.click(190, 10));
    expect(marker()?.lngLat).toEqual([-170, 10]);
  });

  it("accepts a click straight after being enabled, before passive effects run", async () => {
    const view = render(<Harness disabled />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    act(() => map.emit("load"));
    // Re-render enabled and click in the same synchronous block: no effects flush between.
    act(() => {
      view.rerender(<Harness disabled={false} />);
    });
    act(() => map.click(5, 5));
    expect(screen.getByText("Your pin: 5.00° N, 5.00° E")).toBeInTheDocument();
  });

  it("ignores clicks while disabled", async () => {
    const { map } = await renderGlobe({ disabled: true });
    act(() => map.click(2, 48));
    expect(screen.getByText("Place your pin")).toBeInTheDocument();
    expect(FakeMarker.instances).toHaveLength(0);
  });

  it("can be played without a mouse", async () => {
    const { map, globe } = await renderGlobe();
    map.center = { lng: 100, lat: 0 };

    fireEvent.keyDown(globe, { key: "Enter" });
    expect(screen.getByText("Your pin: 0.00° N, 100.00° E")).toBeInTheDocument();

    fireEvent.keyDown(globe, { key: "ArrowUp" });
    expect(screen.getByText("Your pin: 1.00° N, 100.00° E")).toBeInTheDocument();

    fireEvent.keyDown(globe, { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByText("Your pin: 1.00° N, 90.00° E")).toBeInTheDocument();
    expect(marker()?.lngLat).toEqual([90, 1]);
    expect(map.easeToCalls.at(-1)?.center).toEqual([90, 1]);

    fireEvent.keyDown(globe, { key: "+" });
    fireEvent.keyDown(globe, { key: "-" });
    expect(map.zoomInCalls).toBe(1);
    expect(map.zoomOutCalls).toBe(1);
  });

  it("starts arrow-key movement from the centre of the view when there is no pin", async () => {
    const { map, globe } = await renderGlobe();
    map.center = { lng: -60, lat: -10 };
    fireEvent.keyDown(globe, { key: "ArrowRight" });
    expect(screen.getByText("Your pin: 10.00° S, 59.00° W")).toBeInTheDocument();
  });

  it("does not move the pin from the keyboard while disabled, but still zooms", async () => {
    const { map, globe } = await renderGlobe({ initial: { lng: 0, lat: 0 }, disabled: true });
    fireEvent.keyDown(globe, { key: "ArrowUp" });
    fireEvent.keyDown(globe, { key: "+" });
    expect(screen.getByText("Your pin: 0.00° N, 0.00° E")).toBeInTheDocument();
    expect(map.zoomInCalls).toBe(1);
  });

  it("shows a pin passed in before the map finished loading", async () => {
    await renderGlobe({ initial: { lng: 139.69, lat: 35.69 } });
    expect(marker()?.lngLat).toEqual([139.69, 35.69]);
  });

  it("removes the map when unmounted", async () => {
    const { map, unmount } = await renderGlobe();
    unmount();
    expect(map.removed).toBe(true);
  });

  describe("reveal", () => {
    const KYOTO = { lng: 135.7681, lat: 35.0116 };
    const view: RevealView = {
      truth: KYOTO,
      guesses: [
        { actor: "player", at: { lng: 2.35, lat: 48.86 } },
        { actor: "atlas", at: { lng: 135.5, lat: 34.69 } },
      ],
    };
    const lines = (map: FakeMap) => map.sources.reveal.data as RevealLines;
    const markerClasses = () =>
      FakeMarker.instances.filter((m) => m.map).map((m) => m.element.className);

    function setReducedMotion(reduce: boolean) {
      window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as typeof window.matchMedia;
    }
    afterEach(() => {
      // @ts-expect-error jsdom has no matchMedia; remove the stub between tests.
      delete window.matchMedia;
    });

    it("adds the arc layers when the map loads, with nothing drawn yet", async () => {
      const { map } = await renderGlobe();
      expect(map.layers.map((l) => l.id)).toEqual(["reveal-glow", "reveal-line"]);
      expect(lines(map).features).toHaveLength(0);
    });

    it("draws an arc from every guess to the truth and pins Atlas and the truth", async () => {
      setReducedMotion(true);
      const { map } = await renderGlobe({ initial: view.guesses[0].at, reveal: view });
      const drawn = lines(map).features;
      expect(drawn.map((f) => f.properties.actor)).toEqual(["player", "atlas"]);
      for (const f of drawn) {
        expect(f.geometry.coordinates.at(-1)![0]).toBeCloseTo(KYOTO.lng, 5);
      }
      expect(markerClasses()).toEqual([
        "globe-pin",
        "globe-pin globe-pin--atlas",
        "globe-pin globe-pin--truth",
      ]);
      expect(screen.getByText("It was here: 35.01° N, 135.77° E")).toBeInTheDocument();
    });

    it("jumps instead of flying when the player prefers reduced motion", async () => {
      setReducedMotion(true);
      const { map } = await renderGlobe({ reveal: view });
      expect(map.jumpToCalls).toHaveLength(1);
      expect(map.easeToCalls).toHaveLength(0);
    });

    it("animates the arcs and drops the truth pin once they land", async () => {
      setReducedMotion(false);
      const { map } = await renderGlobe({ reveal: view });
      expect(map.easeToCalls).toHaveLength(1);
      await waitFor(() => expect(markerClasses()).toContain("globe-pin globe-pin--truth"), {
        timeout: 3000,
      });
      expect(lines(map).features[0].geometry.coordinates.length).toBeGreaterThan(90);
    });

    it("clears the arcs and reveal pins for the next round", async () => {
      setReducedMotion(true);
      const view2 = render(<Harness reveal={view} />);
      await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
      const map = FakeMap.instances[0];
      act(() => map.emit("load"));
      expect(lines(map).features).toHaveLength(2);
      view2.rerender(<Harness reveal={null} />);
      expect(lines(map).features).toHaveLength(0);
      expect(markerClasses()).toEqual([]);
    });

    describe("Atlas's belief heatmap", () => {
      const withBelief: RevealView = { ...view, belief: { JP: 0.64, KR: 0.09 } };
      const heat = (map: FakeMap) => map.paint.belief?.["fill-opacity"];

      it("shades Atlas's countries at the reveal and clears them for the next round", async () => {
        setReducedMotion(true);
        const rendered = render(<Harness reveal={null} />);
        await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
        const map = FakeMap.instances[0];
        act(() => map.emit("load"));
        expect(heat(map)).toBeUndefined();

        rendered.rerender(<Harness reveal={withBelief} />);
        expect(heat(map)).toEqual(["match", ["get", "n"], "392", 0.44, "410", 0.165, 0]);

        rendered.rerender(<Harness reveal={null} />);
        expect(heat(map)).toBe(0);
      });

      it("shades nothing when the reveal has no belief (atlas.json from before the heatmap)", async () => {
        setReducedMotion(true);
        const { map } = await renderGlobe({ reveal: view });
        expect(heat(map)).toBeUndefined();
      });
    });
  });
});
