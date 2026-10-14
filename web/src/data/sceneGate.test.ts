// @vitest-environment node
import { describe, expect, it } from "vitest";

import { REASONS, buildFromRepo, fileTitle, toSceneGate } from "../../scripts/build-scene-gate.mjs";
import sceneGate from "./scene_gate.json";

describe("bundled scene gate summary", () => {
  it("is in sync with data/scene_gate/ (run `npm run scene-gate` if this fails)", () => {
    expect(sceneGate).toEqual(buildFromRepo());
  });

  it("only shows rejects caught for their own reason, never more than the report counted", () => {
    for (const reason of REASONS) {
      const shown = sceneGate.examples.filter((e) => e.reason === reason).length;
      const r = sceneGate.rejects[reason as keyof typeof sceneGate.rejects];
      expect(shown).toBeLessThanOrEqual(r.caught_for_label);
    }
    for (const e of sceneGate.examples) {
      expect(e.imageUrl).toMatch(/^https:\/\//);
      expect(e.credit.author).not.toBe("");
      expect(e.credit.license).not.toBe("");
    }
  });

  it("picks the highest-scoring catches and ignores reasons the report says caught nothing", () => {
    const report = {
      thresholds: { people: 0.5, indoor: 1.0, text: 0.5, not_photo: 0.5 },
      catalog: { n: 1, passed: 1, rejected_by: {} },
      rejects: {
        people: { n: 3, caught: 2, caught_for_label: 2 },
        indoor: { n: 1, caught: 0, caught_for_label: 0 },
        text: { n: 0, caught: 0, caught_for_label: 0 },
        not_photo: { n: 0, caught: 0, caught_for_label: 0 },
      },
    };
    const rejects = [
      "title,label,image_url,author,license,source_url",
      "File:a.jpg,people,https://x/a,A,CC0,https://s/a",
      "File:b.jpg,people,https://x/b,B,CC0,https://s/b",
      "File:c.jpg,people,https://x/c,C,CC0,https://s/c",
      "File:d.png,indoor,https://x/d,D,CC0,https://s/d",
    ].join("\n");
    const scores = [
      "id,set,label,people,indoor,text,not_photo",
      "File:a.jpg,reject,people,0.6,0,0,0",
      "File:b.jpg,reject,people,0.9,0,0,0",
      "File:c.jpg,reject,people,0.1,0,0,0",
      "File:d.png,reject,indoor,0,1.000000,0,0",
    ].join("\n");
    const out = toSceneGate(report, rejects, scores);
    expect(out.examples.map((e: { title: string }) => e.title)).toEqual(["b", "a"]);
  });

  it("works with log-odds scores and keeps only the catalog counts", () => {
    const report = {
      thresholds: { people: 9.153, indoor: -1.5, text: 0.5, not_photo: 0.5 },
      catalog: {
        n: 2,
        passed: 2,
        rejected_by: { people: 0, indoor: 0, text: 0, not_photo: 0 },
        closest: { people: [{ id: "wm077", score: 9.152 }] },
      },
      rejects: {
        people: { n: 2, caught: 1, caught_for_label: 1 },
        indoor: { n: 1, caught: 1, caught_for_label: 1 },
        text: { n: 0, caught: 0, caught_for_label: 0 },
        not_photo: { n: 0, caught: 0, caught_for_label: 0 },
      },
    };
    const rejects = [
      "title,label,image_url,author,license,source_url",
      "File:a.jpg,people,https://x/a,A,CC0,https://s/a",
      "File:b.jpg,people,https://x/b,B,CC0,https://s/b",
      "File:c.jpg,indoor,https://x/c,C,CC0,https://s/c",
    ].join("\n");
    const scores = [
      "id,set,label,people,indoor,text,not_photo",
      "File:a.jpg,reject,people,9.251000,0,0,0",
      "File:b.jpg,reject,people,9.152000,0,0,0",
      "File:c.jpg,reject,indoor,-3,-1.2,-4,-5",
    ].join("\n");
    const out = toSceneGate(report, rejects, scores);
    expect(out.examples.map((e: { title: string }) => e.title)).toEqual(["a", "c"]);
    expect(out.catalog).toEqual({ n: 2, passed: 2, rejected_by: report.catalog.rejected_by });
  });

  it("names a Commons file without its prefix and extension", () => {
    expect(fileTitle("File:Ackergasse 16 (D)-02.jpg")).toBe("Ackergasse 16 (D)-02");
  });
});
