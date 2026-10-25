import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import sceneGate from "@/data/scene_gate.json";
import { gateStrength } from "@/lib/sceneGate";
import { niceMax } from "@/components/ContinentChart";
import type { AtlasData, CatalogPhoto } from "@/lib/game/types";

import { POCKET_SYSTEM, calibrationNote, retrievalNote, systemLabel } from "@/lib/atlas";
import { gameRecords } from "@/lib/game/deck";
import { surenessBands } from "@/lib/game/sureness";
import { byContinent, scoreGuesses } from "@/lib/atlasReport";

import AtlasPage from "./page";

const atlas = atlasData as AtlasData;

describe("How Atlas guesses", () => {
  it("walks through the three steps in order", () => {
    render(<AtlasPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "How Atlas guesses" }),
    ).toBeInTheDocument();
    const steps = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(steps.slice(0, 3)).toEqual(["Read the photo", "Pick a country", "Pick a city"]);
  });

  it("shows the results of the run that made the guesses, or says they are coming", () => {
    render(<AtlasPage />);
    const systems = atlas.evaluation?.systems ?? [];
    if (systems.length === 0) {
      expect(screen.getByText(/appears here after Atlas's next run/)).toBeInTheDocument();
      return;
    }
    const table = screen.getByRole("table", { name: /How close each system got/ });
    expect(within(table).getAllByRole("row")).toHaveLength(systems.length + 1);
    const playing = systems.filter((s) => s.playsInGame);
    expect(playing).toHaveLength(1);
    expect(within(table).getByText("The Atlas you play against")).toBeInTheDocument();
  });

  it("says whether the retrieval refinement plays, once a run has tried it", () => {
    render(<AtlasPage />);
    const retrieval = atlas.evaluation?.retrieval;
    const note = screen.queryByTestId("retrieval-note");
    if (!retrieval) {
      expect(note).toBeNull();
      return;
    }
    expect(note).toHaveTextContent(retrievalNote(retrieval));
    const refined = atlas.evaluation!.systems.find((s) =>
      s.name.endsWith("then nearest reference photos"),
    );
    expect(refined?.playsInGame).toBe(retrieval.ships);
  });

  it("shows how often Atlas was right at each level of confidence, from the shipped photos", () => {
    render(<AtlasPage />);
    const bands = surenessBands(gameRecords(catalog as CatalogPhoto[], atlas)).filter((b) => b.n);
    const table = screen.getByTestId("sureness-table");
    expect(within(table).getAllByRole("row")).toHaveLength(bands.length + 1);
    const first = bands[0];
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      `${Math.round(first.lo * 100)}–${Math.round(first.hi * 100)}% sure${first.n}${first.right}`,
    );
    const calibration = atlas.evaluation?.calibration;
    const note = screen.queryByTestId("calibration-note");
    if (calibration) expect(note).toHaveTextContent(calibrationNote(calibration));
    else expect(note).toBeNull();
  });

  it("breaks Atlas down by continent, with a table for screen readers", () => {
    render(<AtlasPage />);
    expect(screen.getByRole("heading", { name: "Where Atlas struggles" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Atlas's median error by continent" }),
    ).toBeInTheDocument();
    const rows = byContinent(scoreGuesses(catalog as CatalogPhoto[], atlas));
    const tables = screen.getAllByRole("table");
    const chartTable = tables.find((t) => within(t).queryByText("Continent"));
    expect(chartTable).toBeDefined();
    expect(within(chartTable!).getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("shows Atlas's three closest and three furthest guesses, credited", () => {
    render(<AtlasPage />);
    for (const name of ["Atlas's closest guesses", "Atlas's furthest guesses"]) {
      const list = screen.getByRole("list", { name });
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(3);
      for (const item of items) expect(within(item).getByRole("link")).toHaveAttribute("href");
    }
  });

  it("links back to the game", () => {
    render(<AtlasPage />);
    expect(screen.getByRole("link", { name: "Play today's five" })).toHaveAttribute(
      "href",
      "/?daily",
    );
  });
});

describe("niceMax", () => {
  it("rounds a scale up to 1, 2 or 5 times a power of ten", () => {
    expect(niceMax(949)).toBe(1000);
    expect(niceMax(1200)).toBe(2000);
    expect(niceMax(3100)).toBe(5000);
    expect(niceMax(5000)).toBe(5000);
    expect(niceMax(0)).toBe(1);
  });
});

describe("systemLabel", () => {
  it("turns model ids into readable names", () => {
    expect(systemLabel("ViT-L-14/openai, country then city")).toBe(
      "CLIP ViT-L/14 (OpenAI), country then city",
    );
    expect(systemLabel("Random city (baseline)")).toBe("Random city");
    expect(systemLabel(POCKET_SYSTEM)).toBe("CLIP ViT-B/32 (OpenAI), country then city");
  });
});

describe("Choosing the photos", () => {
  it("shows the photo screen's real counts and the images it turned away", () => {
    render(<AtlasPage />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Choosing the photos" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /photo screen catches/ });
    const people = within(table).getByRole("row", { name: /People in the shot/ });
    const { n, caught_for_label } = sceneGate.rejects.people;
    expect(within(people).getAllByRole("cell")[0]).toHaveTextContent(`${caught_for_label} of ${n}`);
    const gallery = screen.getByRole("list", { name: "Images the screen turned away" });
    expect(within(gallery).getAllByRole("listitem")).toHaveLength(sceneGate.examples.length);
  });

  it("has a row for every reason the report counted, and none for an uncalibrated one", () => {
    render(<AtlasPage />);
    const table = screen.getByRole("table", { name: /photo screen catches/ });
    const body = within(table).getAllByRole("rowgroup")[1];
    expect(within(body).getAllByRole("row")).toHaveLength(Object.keys(sceneGate.rejects).length);
    const closeUp = within(body).queryByRole("row", { name: /Close-ups of animals and plants/ });
    expect(closeUp !== null).toBe("close_up" in sceneGate.rejects);
  });

  it("says which reasons still slip past from the real counts, not fixed text", () => {
    const { container } = render(<AtlasPage />);
    const reasons = ["people", "text", "indoor", "not_photo", "close_up"] as const;
    const { strong, weak } = gateStrength(sceneGate.rejects, reasons);
    const text = container.textContent ?? "";
    expect(text.includes("It catches most")).toBe(strong.length > 0);
    expect(text.includes("still slip past it")).toBe(weak.length > 0);
  });
});
