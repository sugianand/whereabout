// Converts the scene gate's calibration report (data/scene_gate/) into src/data/scene_gate.json,
// the small summary the "How Atlas guesses" page shows: real pass/reject counts and a few
// example rejects the gate caught for the reason they were labelled with.
// Run: npm run scene-gate   (a test fails if the committed JSON is out of date)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseCsv } from "./build-catalog.mjs";

const dir = new URL("../../data/scene_gate/", import.meta.url);
const outPath = fileURLToPath(new URL("../src/data/scene_gate.json", import.meta.url));

export const REASONS = ["people", "indoor", "text", "not_photo"];
const EXAMPLES_PER_REASON = 2;

function rows(text) {
  const [header, ...body] = parseCsv(text);
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
}

/** A readable name for a Commons file: no "File:" prefix, no extension. */
export function fileTitle(title) {
  return title.replace(/^File:/, "").replace(/\.(jpe?g|png)$/i, "");
}

/**
 * Summarise the report. Examples are rejects whose score for their own label is over that
 * label's threshold (caught for the right reason), highest score first; ties break by title so
 * the output is stable. Scores and thresholds are log-odds (any real number); scores.csv is
 * rounded to six decimals, so the report's own count of catches decides how many examples a
 * reason may show, and a reason that caught nothing shows none. Only the catalog's counts are
 * kept: the report's list of closest keepers is for review, not for the site.
 */
export function toSceneGate(report, rejectsCsv, scoresCsv) {
  const rejects = new Map(rows(rejectsCsv).map((r) => [r.title, r]));
  const scored = rows(scoresCsv).filter((r) => r.set === "reject");
  const examples = [];
  for (const reason of REASONS) {
    const threshold = report.thresholds[reason];
    const caught = scored
      .filter((r) => r.label === reason && Number(r[reason]) >= threshold && rejects.has(r.id))
      .sort((a, b) => Number(b[reason]) - Number(a[reason]) || a.id.localeCompare(b.id))
      .slice(0, Math.min(EXAMPLES_PER_REASON, report.rejects[reason]?.caught_for_label ?? 0));
    for (const r of caught) {
      const src = rejects.get(r.id);
      examples.push({
        reason,
        title: fileTitle(src.title),
        imageUrl: src.image_url,
        score: Number(r[reason]),
        credit: { author: src.author, license: src.license, sourceUrl: src.source_url },
      });
    }
  }
  return {
    thresholds: report.thresholds,
    catalog: {
      n: report.catalog.n,
      passed: report.catalog.passed,
      rejected_by: report.catalog.rejected_by,
    },
    rejects: Object.fromEntries(REASONS.map((r) => [r, report.rejects[r]])),
    examples,
  };
}

export function buildFromRepo() {
  return toSceneGate(
    JSON.parse(readFileSync(new URL("report.json", dir), "utf8")),
    readFileSync(new URL("rejects.csv", dir), "utf8"),
    readFileSync(new URL("scores.csv", dir), "utf8"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gate = buildFromRepo();
  writeFileSync(outPath, JSON.stringify(gate, null, 1) + "\n");
  console.log(`wrote the scene gate summary (${gate.examples.length} examples) to ${outPath}`);
}
