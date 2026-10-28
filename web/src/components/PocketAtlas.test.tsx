import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../data/fixtures/pocket_cases.json";
import type { ImageEncoder } from "@/lib/pocket/encoder";
import { IndexUnavailable } from "@/lib/pocket/index";
import type { Pixels } from "@/lib/pocket/saliency";
import { decodeIndex, type PocketMeta } from "@/lib/pocket/locate";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import PocketAtlas, { type PocketDeps } from "./PocketAtlas";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

const index = decodeIndex(fixture.meta as PocketMeta, Int8Array.from(fixture.vectors.flat()));
// Fixture case 0 is a "Peru, Cusco" image: the toy index guesses Cusco.
const CUSCO = fixture.cases[0];
// Zero-shot Pocket Atlas's bands for the toy (CALIBRATION in ml/tests/test_pocket_index.py),
// before the distilled head replaced them with its own.
const CALIBRATION_SURENESS = [
  { lo: 0.0, hi: 0.2, n: 0, right: 0 },
  { lo: 0.2, hi: 0.4, n: 0, right: 0 },
  { lo: 0.4, hi: 0.6, n: 12, right: 5 },
  { lo: 0.6, hi: 0.8, n: 14, right: 9 },
  { lo: 0.8, hi: 1.0, n: 30, right: 27 },
];
// Photos the toy privacy gate declines: people in Kyoto, a room in Osaka, both in Lima.
const gated = (reasons: string) => fixture.cases.find((c) => c.gate.reasons.join("+") === reasons)!;

/** A fake encoder that embeds every photo as `image`, and every edited copy by `look`. */
function encoderFor(
  image: number[],
  look: (pixels: Pixels) => Promise<number[]> | number[] = () => image,
): ImageEncoder {
  return {
    embed: async () => Float32Array.from(image),
    prepare: async () => ({
      pixels: { data: new Float32Array(3 * 14 * 14).fill(1), dims: [3, 14, 14] },
      width: 640,
      height: 480,
    }),
    embedPixels: async (pixels) => Float32Array.from(await look(pixels)),
  };
}

function deps(overrides: Partial<PocketDeps> = {}): PocketDeps {
  return {
    loadIndex: async () => index,
    loadEncoder: async (_id, onProgress) => {
      onProgress({ loaded: 45e6, total: 90e6 });
      return encoderFor(CUSCO.image);
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
    expect(window.__pocketAtlas?.guess?.city).toBe("Cusco");
    expect(window.__pocketAtlas?.gate.passed).toBe(true);
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

  it("shades the globe by how sure it was at the reveal, and says how sure of the pinned country", async () => {
    // The last fixture case leans Japan only a little: 64% Japan, 36% Peru after T = 1.8.
    const unsure = fixture.cases.at(-1)!;
    const heat = (map: FakeMap) => map.paint.belief?.["fill-opacity"];
    const play = async (lng: number, lat: number) => {
      const rendered = render(
        <PocketAtlas
          deps={deps({
            loadEncoder: async () => encoderFor(unsure.image),
          })}
        />,
      );
      choosePhoto();
      await screen.findByText(/64% sure of the country\./);
      await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
      const map = FakeMap.instances.at(-1)!;
      act(() => map.emit("load"));
      // No heatmap while the player is still placing the real location.
      expect(heat(map) ?? 0).toBe(0);
      act(() => map.click(lng, lat));
      fireEvent.click(screen.getByRole("button", { name: "That's where it was" }));
      const line = await screen.findByTestId("pocket-heatmap");
      return { rendered, map, line };
    };

    // Cusco, Peru: the country Atlas gave the remaining third.
    const peru = await play(-71.97, -13.53);
    expect(heat(peru.map)).toEqual([
      "match",
      ["get", "n"],
      "392",
      expect.any(Number),
      "604",
      expect.any(Number),
      0,
    ]);
    expect(peru.line).toHaveTextContent(/darker, the surer\. It gave Peru 36%\./);
    peru.rendered.unmount();

    // Paris: a country Atlas never considered reads "under 1%", not "0%".
    const france = await play(2.35, 48.86);
    expect(france.line).toHaveTextContent(/It gave France under 1%\./);
    france.rendered.unmount();

    // The middle of the Pacific: no country to name.
    const sea = await play(-140, 0);
    expect(sea.line).toHaveTextContent(/darker, the surer\.$/);
  });

  it("checks its own '% sure' against the photos it was calibrated on, like the reveal", async () => {
    // The last fixture case leans Japan only a little: the toy index's T = 1.8 makes it 64% sure.
    const unsure = fixture.cases.at(-1)!;
    const zeroShot: PocketMeta = {
      ...(fixture.meta as PocketMeta),
      distillation: undefined,
      sureness: CALIBRATION_SURENESS,
    };
    render(
      <PocketAtlas
        deps={deps({
          loadIndex: async () => decodeIndex(zeroShot, Int8Array.from(fixture.vectors.flat())),
          loadEncoder: async () => encoderFor(unsure.image),
        })}
      />,
    );
    choosePhoto();
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByText(/64% sure of the country\./)).toBeInTheDocument();
    expect(within(result).getByTestId("pocket-sureness")).toHaveTextContent(
      "When Atlas is 60–80% sure, it names the right country in 9 of 14 photos.",
    );
    expect(within(result).queryByTestId("pocket-taught")).toBeNull();
  });

  it("lets a head taught by the game's Atlas name the countries, and checks it on its own bands", async () => {
    // A snow scene with no country in it: zero-shot can't tell, the taught head says Peru.
    const snow = fixture.cases.find((c) => c.expected.country === "PE" && c.image[6] > 0.5)!;
    render(<PocketAtlas deps={deps({ loadEncoder: async () => encoderFor(snow.image) })} />);
    choosePhoto();
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByRole("heading", { name: snow.expected.city })).toBeVisible();
    const countries = within(result).getByRole("list", { name: "Atlas's most likely countries" });
    expect(within(countries).getAllByRole("listitem")[0]).toHaveTextContent("Peru");
    expect(within(result).getByTestId("pocket-taught")).toHaveTextContent("keyword/big");
  });

  it("checks a taught head's '% sure' against the head's own held-out bands", async () => {
    const unsure = fixture.cases.at(-1)!;
    render(<PocketAtlas deps={deps({ loadEncoder: async () => encoderFor(unsure.image) })} />);
    choosePhoto();
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    expect(await within(result).findByText(/64% sure of the country\./)).toBeInTheDocument();
    // 12 of 16 is the head's band; zero-shot's was 9 of 14.
    expect(within(result).getByTestId("pocket-sureness")).toHaveTextContent(
      "When Atlas is 60–80% sure, it names the right country in 12 of 16 photos.",
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
          finish = () => resolve(encoderFor(CUSCO.image));
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

  it("declines a photo of people without guessing where it was, then guesses the next one", async () => {
    let photo = gated("people").image;
    render(
      <PocketAtlas
        deps={deps({
          loadEncoder: async () => ({
            ...encoderFor([]),
            embed: async () => Float32Array.from(photo),
          }),
        })}
      />,
    );
    choosePhoto("friends.jpg");
    const result = screen.getByRole("region", { name: "Atlas's guess" });
    const declined = await within(result).findByTestId("pocket-declined");
    expect(declined).toHaveTextContent("Atlas is keeping this one private");
    expect(declined).toHaveTextContent("there are people in it");
    // Nothing about a place: no city, no shortlist, no globe to score it on.
    expect(within(result).queryByRole("heading", { name: "Kyoto" })).toBeNull();
    expect(result).not.toHaveTextContent(/Kyoto|Japan|sure of the country/);
    expect(
      within(result).queryByRole("list", { name: "Atlas's most likely countries" }),
    ).toBeNull();
    expect(FakeMap.instances).toHaveLength(0);
    expect(window.__pocketAtlas?.guess).toBeNull();
    expect(window.__pocketAtlas?.gate.reasons).toEqual(["people"]);

    photo = CUSCO.image;
    choosePhoto("andes.jpg");
    expect(await within(result).findByRole("heading", { name: "Cusco" })).toBeInTheDocument();
    expect(within(result).queryByTestId("pocket-declined")).toBeNull();
  });

  it.each([
    ["indoor", /taken indoors\./],
    ["people+indoor", /people in it, and it looks like it was taken indoors/],
  ])("declines a photo the gate flags as %s", async (reasons, message) => {
    const image = gated(reasons).image;
    render(<PocketAtlas deps={deps({ loadEncoder: async () => encoderFor(image) })} />);
    choosePhoto();
    expect(await screen.findByTestId("pocket-declined")).toHaveTextContent(message);
    expect(window.__pocketAtlas?.guess).toBeNull();
  });

  it("stays closed, without downloading the model, when the index has no privacy gate", async () => {
    const ungated = decodeIndex(
      { ...(fixture.meta as PocketMeta), gate: undefined },
      Int8Array.from(fixture.vectors.flat()),
    );
    const loadEncoder = vi.fn(deps().loadEncoder);
    render(<PocketAtlas deps={deps({ loadIndex: async () => ungated, loadEncoder })} />);
    choosePhoto();
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't published yet");
    expect(loadEncoder).not.toHaveBeenCalled();
    expect(window.__pocketAtlas).toBeUndefined();
  });

  describe("Where Atlas looked", () => {
    // A photo whose top-left corner is all Atlas needs: with it, Cusco; without it, the unsure
    // Japan-leaning case. So hiding that one cell is what costs Atlas its belief in Peru.
    const UNSURE = fixture.cases.at(-1)!.image;
    const cornerOnly = (pixels: Pixels) => (pixels.data[0] === 0 ? UNSURE : CUSCO.image);

    beforeEach(() => {
      // The random cells, made repeatable: {1, 3, 24, 25, 26}, none of them the corner.
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });
    afterEach(() => vi.restoreAllMocks());

    it("shows, on request, the part of the photo the guess rests on, and checks it", async () => {
      const look = vi.fn(cornerOnly);
      render(
        <PocketAtlas deps={deps({ loadEncoder: async () => encoderFor(CUSCO.image, look) })} />,
      );
      choosePhoto();
      const result = screen.getByRole("region", { name: "Atlas's guess" });
      await within(result).findByRole("heading", { name: "Cusco" });
      // Nothing runs until the player asks: phones only pay for it on request.
      expect(look).not.toHaveBeenCalled();
      expect(within(result).queryByRole("img", { name: /Where Atlas looked/ })).toBeNull();

      fireEvent.click(within(result).getByRole("button", { name: "Where did Atlas look?" }));
      const eyes = await within(result).findByRole("img", { name: /Where Atlas looked/ });
      expect(eyes).toHaveAccessibleName("Where Atlas looked: mostly the top left of the photo");
      // The photo, 49 cells hidden one at a time, then the deletion test's 5 passes.
      expect(look).toHaveBeenCalledTimes(1 + 49 + 2 + 3);

      const looked = window.__pocketAtlas?.looked;
      expect(looked?.cells[0]).toBe(1);
      expect(looked?.cells.slice(1).every((v) => v === 0)).toBe(true);
      // 640 × 480: CLIP sees the centre 480 × 480 square.
      expect(looked?.crop).toEqual([0.125, 0, 0.75, 1]);
      expect(looked!.topKDrop).toBeGreaterThan(0.5);
      expect(looked!.randomKDrop).toBe(0);
      expect(within(result).getByTestId("pocket-looked")).toHaveTextContent(
        new RegExp(
          `belief in Peru most\\. Hiding the 5 patches it leaned on most cut it by ` +
            `${Math.round(looked!.topKDrop * 100)}%; hiding 5 random patches cut it by 0%\\. ` +
            `So the glow does show what this guess rests on\\.`,
        ),
      );
      expect(within(result).queryByRole("button", { name: "Where did Atlas look?" })).toBeNull();
    });

    it("says when the map is a weak guide, and forgets it when the next photo arrives", async () => {
      // Nothing in particular matters: every copy embeds the same, so no cell stands out.
      render(<PocketAtlas deps={deps()} />);
      choosePhoto();
      fireEvent.click(await screen.findByRole("button", { name: "Where did Atlas look?" }));
      const looked = await screen.findByTestId("pocket-looked");
      await waitFor(() => expect(looked).toHaveTextContent(/weak guide/));
      expect(screen.getByRole("img", { name: /Where Atlas looked/ })).toHaveAccessibleName(
        "Where Atlas looked: no single part of the photo stood out",
      );

      choosePhoto("next.jpg");
      expect(
        await screen.findByRole("button", { name: "Where did Atlas look?" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: /Where Atlas looked/ })).toBeNull();
    });

    it("drops a run that was still going when a new photo arrived", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const look = vi.fn(async (pixels: Pixels) => {
        await gate;
        return cornerOnly(pixels);
      });
      render(
        <PocketAtlas deps={deps({ loadEncoder: async () => encoderFor(CUSCO.image, look) })} />,
      );
      choosePhoto();
      fireEvent.click(await screen.findByRole("button", { name: "Where did Atlas look?" }));
      expect(
        await screen.findByRole("progressbar", { name: "Finding where Atlas looked" }),
      ).toBeInTheDocument();

      choosePhoto("next.jpg");
      await screen.findByRole("button", { name: "Where did Atlas look?" });
      await act(async () => release());
      // The old run stops at its next pass instead of finishing ~55 passes for a photo that's gone.
      expect(look).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("img", { name: /Where Atlas looked/ })).toBeNull();
      expect(screen.queryByRole("progressbar", { name: "Finding where Atlas looked" })).toBeNull();
      expect(window.__pocketAtlas?.looked).toBeUndefined();
    });
  });
});
