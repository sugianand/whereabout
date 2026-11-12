import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_MIX_UPS,
  MIX_UPS_KEY,
  keepMixUp,
  loadMixUps,
  mixUpLine,
  mixUpPairs,
  noteMixUp,
  parseMixUps,
  practiceContinent,
  timesWord,
  type MixUp,
} from "./mixUps";

const m = (truth: string, picked: string): MixUp => ({ truth, picked });

describe("noteMixUp", () => {
  it("adds the newest last and keeps only the newest past the cap", () => {
    const log = noteMixUp([m("JP", "KR")], m("NO", "SE"));
    expect(log).toEqual([m("JP", "KR"), m("NO", "SE")]);
    const capped = noteMixUp([m("JP", "KR"), m("NO", "SE"), m("PT", "ES")], m("AR", "CL"), 3);
    expect(capped).toEqual([m("NO", "SE"), m("PT", "ES"), m("AR", "CL")]);
  });
});

describe("parseMixUps", () => {
  it("keeps the well-formed wrong taps and drops the rest", () => {
    expect(
      parseMixUps([
        m("JP", "KR"),
        m("JP", "JP"),
        { truth: "jp", picked: "KR" },
        { truth: "JPN", picked: "KR" },
        { truth: "JP" },
        null,
        [],
        "JP-KR",
        { truth: "NO", picked: "SE", extra: 1 },
      ]),
    ).toEqual([m("JP", "KR"), m("NO", "SE")]);
  });

  it("is empty for anything but a list, and keeps the newest up to the cap", () => {
    expect(parseMixUps({ truth: "JP", picked: "KR" })).toEqual([]);
    expect(parseMixUps(null)).toEqual([]);
    const long = Array.from({ length: MAX_MIX_UPS + 5 }, (_, i) => m(i < 5 ? "NO" : "JP", "KR"));
    const kept = parseMixUps(long);
    expect(kept).toHaveLength(MAX_MIX_UPS);
    expect(kept.every((e) => e.truth === "JP")).toBe(true);
  });
});

describe("keepMixUp and loadMixUps", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a wrong tap, upper-casing the codes, newest last", () => {
    keepMixUp("JP", "KR");
    keepMixUp("no", "se");
    expect(loadMixUps()).toEqual([m("JP", "KR"), m("NO", "SE")]);
    expect(JSON.parse(localStorage.getItem(MIX_UPS_KEY)!)).toHaveLength(2);
  });

  it("keeps nothing for a right answer, the sea or a code that isn't one", () => {
    keepMixUp("JP", "JP");
    keepMixUp("JP", null);
    keepMixUp(undefined, "KR");
    keepMixUp("Japan", "KR");
    expect(loadMixUps()).toEqual([]);
  });

  it("reads junk storage as nothing kept", () => {
    localStorage.setItem(MIX_UPS_KEY, "{not json");
    expect(loadMixUps()).toEqual([]);
    keepMixUp("JP", "KR");
    expect(loadMixUps()).toEqual([m("JP", "KR")]);
  });
});

describe("mixUpPairs", () => {
  it("counts a pair either way round, the country more often the photo's first", () => {
    const [pair] = mixUpPairs([m("KR", "JP"), m("JP", "KR"), m("KR", "JP")]);
    expect(pair).toMatchObject({ a: "KR", b: "JP", times: 3, bForA: 2, aForB: 1 });
  });

  it("orders by how often, then by the most recent, and keeps the top few", () => {
    const log = [
      m("NO", "SE"),
      m("JP", "KR"),
      m("JP", "KR"),
      m("AR", "CL"),
      m("PT", "ES"),
      m("NO", "SE"),
      m("FI", "EE"),
    ];
    const pairs = mixUpPairs(log);
    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual([
      "NO-SE",
      "JP-KR",
      "FI-EE",
      "PT-ES",
      "AR-CL",
    ]);
    expect(mixUpPairs(log, 2)).toHaveLength(2);
    expect(mixUpPairs([])).toEqual([]);
  });

  it("reads the same on a tie, alphabetically", () => {
    const [pair] = mixUpPairs([m("SE", "NO"), m("NO", "SE")]);
    expect(pair).toMatchObject({ a: "NO", b: "SE", bForA: 1, aForB: 1 });
  });
});

describe("the words", () => {
  it("says how often in words", () => {
    expect(timesWord(1)).toBe("once");
    expect(timesWord(2)).toBe("twice");
    expect(timesWord(1200)).toBe("1,200 times");
  });

  it("names only the directions that happened, with their articles", () => {
    const [one] = mixUpPairs([m("JP", "KR"), m("JP", "KR")]);
    expect(mixUpLine(one)).toBe("You said South Korea for Japan twice.");
    const [both] = mixUpPairs([m("US", "CA"), m("US", "CA"), m("CA", "US")]);
    expect(mixUpLine(both)).toBe(
      "You said Canada for the United States twice, and the United States for Canada once.",
    );
  });
});

describe("practiceContinent", () => {
  const [jpKr] = mixUpPairs([m("JP", "KR")]);
  const [nzAu] = mixUpPairs([m("NZ", "IE")]);

  it("practises where the missed photos were, if a streak can be dealt there", () => {
    expect(practiceContinent(jpKr, ["Asia", "Europe"])).toBe("Asia");
    expect(practiceContinent(nzAu, ["Oceania", "Europe"])).toBe("Oceania");
  });

  it("falls back to the other country's continent, or nothing", () => {
    expect(practiceContinent(nzAu, ["Europe"])).toBe("Europe");
    expect(practiceContinent(jpKr, ["Europe"])).toBeNull();
    const [odd] = mixUpPairs([m("ZZ", "QQ")]);
    expect(practiceContinent(odd, ["Asia"])).toBeNull();
  });
});
