import { describe, expect, it } from "vitest";

import type { PlayedPhoto } from "@/lib/playedMap";

import { MAX_WEEKS, weekLabel, weekStart, weeklyForm } from "./weeklyForm";

let n = 0;
const round = (day: string, km: number | null): PlayedPhoto => {
  n += 1;
  return { id: `p${n}`, lng: 0, lat: 0, place: `Place ${n}`, country: "FR", km, score: 1000, day };
};

describe("weekStart", () => {
  it("files every day under the Monday of its UTC week", () => {
    // 2026-11-09 is a Monday.
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-12")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday ends the week
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
  });

  it("crosses months and years", () => {
    expect(weekStart("2026-03-01")).toBe("2026-02-23");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekLabel", () => {
  it("names the Monday as month and day", () => {
    expect(weekLabel("2026-11-09")).toBe("Nov 9");
  });
});

describe("weeklyForm", () => {
  it("draws nothing until two weeks have pinned rounds", () => {
    expect(weeklyForm([])).toBeNull();
    expect(weeklyForm([round("2026-11-02", 500), round("2026-11-04", 900)])).toBeNull();
    // A second week whose only round has no pin still has nothing to compare.
    expect(weeklyForm([round("2026-11-02", 500), round("2026-11-10", null)])).toBeNull();
  });

  it("takes each week's median over its pinned rounds and compares the newest two", () => {
    const form = weeklyForm([
      round("2026-11-02", 100),
      round("2026-11-03", 9000), // one wild miss doesn't swamp the week
      round("2026-11-04", 300),
      round("2026-11-10", 50),
      round("2026-11-11", null),
      round("2026-11-12", 70),
    ])!;
    expect(form.weeks.map((w) => [w.start, w.rounds.length, w.pinned, w.medianKm])).toEqual([
      ["2026-11-02", 3, 3, 300],
      ["2026-11-09", 3, 2, 60],
    ]);
    expect(form.latest.trend).toBe("better");
    expect(form.latest.week.start).toBe("2026-11-09");
    expect(form.latest.before.start).toBe("2026-11-02");
  });

  it("keeps quiet weeks as gaps and compares across them", () => {
    const form = weeklyForm([round("2026-10-19", 400), round("2026-11-11", 900)])!;
    expect(form.weeks.map((w) => [w.start, w.rounds.length])).toEqual([
      ["2026-10-19", 1],
      ["2026-10-26", 0],
      ["2026-11-02", 0],
      ["2026-11-09", 1],
    ]);
    expect(form.latest.trend).toBe("worse");
    expect(form.latest.before.start).toBe("2026-10-19");
  });

  it("calls a change within a tenth holding steady", () => {
    const form = weeklyForm([round("2026-11-02", 1000), round("2026-11-09", 1080)])!;
    expect(form.latest.trend).toBe("same");
  });

  it("shows the last weeks up to the newest one played, and needs two of those to chart", () => {
    const history = Array.from({ length: 20 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 6, 6) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      return round(day, 1000 - i * 10);
    });
    const form = weeklyForm(history)!;
    expect(form.weeks).toHaveLength(MAX_WEEKS);
    expect(form.weeks.at(-1)!.start).toBe(weekStart(history.at(-1)!.day));
    expect(form.weeks[0].start).toBe(weekStart(history[20 - MAX_WEEKS].day));

    // An old week that has fallen off the chart doesn't count towards the two it needs.
    const old = [round("2026-01-05", 100), round("2026-11-09", 200)];
    expect(weeklyForm(old)).toBeNull();
  });

  it("files the rounds of a week oldest first, as Your map keeps them", () => {
    const a = round("2026-11-02", 10);
    const b = round("2026-11-09", 20);
    const c = round("2026-11-10", 30);
    const form = weeklyForm([a, b, c])!;
    expect(form.weeks[1].rounds.map((p) => p.id)).toEqual([b.id, c.id]);
  });
});
