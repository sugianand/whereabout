import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { drivingSideOf, LEFT_HAND_TRAFFIC, NO_ROAD_TRAFFIC } from "./drivingSides";

const labelsPy = readFileSync(resolve(process.cwd(), "../ml/src/whereabout_ml/labels.py"), "utf8");

/** The country codes in one of labels.py's tables. */
function pythonCodes(name: string): string[] {
  const block = new RegExp(`${name}: frozenset\\[str\\] = ([\\s\\S]*?)\\n\\)?\\n\\n`).exec(
    labelsPy,
  );
  if (!block) throw new Error(`${name} not found in labels.py`);
  return [...block[1].matchAll(/\b[A-Z]{2}\b/g)].map((m) => m[0]).sort();
}

describe("drivingSides", () => {
  it("is the same table that labels the photos (ml/src/whereabout_ml/labels.py)", () => {
    expect([...LEFT_HAND_TRAFFIC].sort()).toEqual(pythonCodes("LEFT_HAND_TRAFFIC"));
    expect([...NO_ROAD_TRAFFIC].sort()).toEqual(pythonCodes("NO_ROAD_TRAFFIC"));
  });

  it("knows each country's side and has none for places without roads", () => {
    expect(drivingSideOf("GB")).toBe("left");
    expect(drivingSideOf("jp")).toBe("left");
    expect(drivingSideOf("FR")).toBe("right");
    expect(drivingSideOf("AQ")).toBeNull();
    expect(drivingSideOf("")).toBeNull();
    expect(drivingSideOf(null)).toBeNull();
    expect(drivingSideOf("XYZ")).toBeNull();
  });
});
