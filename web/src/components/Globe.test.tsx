import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeMap, FakeMarker, resetFakes, workerUrls } from "@/test/maplibre-mock";
import type { LngLat } from "@/lib/geo";

import Globe from "./Globe";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function Harness({ initial = null, disabled = false }: { initial?: LngLat | null; disabled?: boolean }) {
  const [pin, setPin] = useState<LngLat | null>(initial);
  return <Globe pin={pin} onPinChange={setPin} disabled={disabled} />;
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
});
