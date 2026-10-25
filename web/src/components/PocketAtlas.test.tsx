import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../data/fixtures/pocket_cases.json";
import { IndexUnavailable } from "@/lib/pocket/index";
import { decodeIndex, type PocketMeta } from "@/lib/pocket/locate";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import PocketAtlas, { type PocketDeps } from "./PocketAtlas";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const index = decodeIndex(fixture.meta as PocketMeta, Int8Array.from(fixture.vectors.flat()));
// Fixture case 0 is a "Peru, Cusco" image: the toy index guesses Cusco.
const CUSCO = fixture.cases[0];

function deps(overrides: Partial<PocketDeps> = {}): PocketDeps {
  return {
    loadIndex: async () => index,
    loadEncoder: async (_id, onProgress) => {
      onProgress({ loaded: 45e6, total: 90e6 });
      return { embed: async () => Float32Array.from(CUSCO.image) };
    },
    ...overrides,
  };
}

function choosePhoto(name = "holiday.jpg", type = "image/jpeg") {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type })] } });
}

beforeEach(() => {
  resetFakes();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia; remove the stub between tests.
  delete window.matchMedia;
  delete window.__pocketAtlas;
});

describe("Pocket Atlas", () => {
  it("guesses on the device, then scores itself against where the photo really was", async () => {
    render(<PocketAtlas deps={deps()} />);
    choosePhoto();

    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByRole("heading", { name: "Cusco" })).toBeInTheDocument();
    expect(
      within(result).getByRole("heading", { name: "Cusco" }).nextElementSibling,
    ).toHaveTextContent("Peru");
    const countries = within(result).getByRole("list", { name: "Atlas's most likely countries" });
    expect(within(countries).getAllByRole("listitem")[0]).toHaveTextContent("Peru");
    expect(window.__pocketAtlas?.guess.city).toBe("Cusco");
    expect(window.__pocketAtlas?.embedding).toHaveLength(fixture.meta.dim);

    const confirm = screen.getByRole("button", { name: "Place a pin first" });
    expect(confirm).toBeDisabled();
    await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
    const map = FakeMap.instances.at(-1)!;
    act(() => map.emit("load"));
    act(() => map.click(-71.97, -13.53)); // Cusco itself
    fireEvent.click(screen.getByRole("button", { name: "That's where it was" }));

    expect(await screen.findByText("Here's how close Atlas got.")).toBeInTheDocument();
    expect(result).toHaveTextContent(/Atlas was 0 m off, worth 5,000 points/);
  });

  it("checks its own '% sure' against the photos it was calibrated on, like the reveal", async () => {
    // The last fixture case leans Japan only a little: the toy index's T = 1.8 makes it 64% sure.
    const unsure = fixture.cases.at(-1)!;
    render(
      <PocketAtlas
        deps={deps({
          loadEncoder: async () => ({ embed: async () => Float32Array.from(unsure.image) }),
        })}
      />,
    );
    choosePhoto();
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByText(/64% sure of the country\./)).toBeInTheDocument();
    expect(within(result).getByTestId("pocket-sureness")).toHaveTextContent(
      "When Atlas is 60–80% sure, it names the right country in 9 of 14 photos.",
    );
  });

  it("says only how sure it is when the index has no calibration yet", async () => {
    const raw: PocketMeta = {
      ...(fixture.meta as PocketMeta),
      temperature: undefined,
      sureness: undefined,
    };
    const uncalibrated = decodeIndex(raw, Int8Array.from(fixture.vectors.flat()));
    render(<PocketAtlas deps={deps({ loadIndex: async () => uncalibrated })} />);
    choosePhoto();
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByText(/100% sure of the country\./)).toBeInTheDocument();
    expect(within(result).queryByTestId("pocket-sureness")).toBeNull();
  });

  it("explains the one-time download while it waits", async () => {
    let finish!: () => void;
    const slow = deps({
      loadEncoder: (_id, onProgress) =>
        new Promise((resolve) => {
          onProgress({ loaded: 45e6, total: 90e6 });
          finish = () => resolve({ embed: async () => Float32Array.from(CUSCO.image) });
        }),
    });
    render(<PocketAtlas deps={slow} />);
    choosePhoto();
    expect(await screen.findByText("Waking Atlas up…")).toBeInTheDocument();
    const bar = await screen.findByRole("progressbar", { name: "Downloading Atlas" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    expect(screen.getByText("45 MB of 90 MB")).toBeInTheDocument();
    act(() => finish());
    expect(await screen.findByRole("heading", { name: "Cusco" })).toBeInTheDocument();
  });

  it("says so when the index isn't published yet, and refuses non-images", async () => {
    const { unmount } = render(
      <PocketAtlas
        deps={deps({
          loadIndex: async () => {
            throw new IndexUnavailable("not yet");
          },
        })}
      />,
    );
    choosePhoto();
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't published yet");
    unmount();

    render(<PocketAtlas deps={deps()} />);
    choosePhoto("notes.txt", "text/plain");
    expect(await screen.findByRole("alert")).toHaveTextContent("That isn't a photo");
  });
});
