import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  THEME_CHANGED,
  THEME_COLOR,
  THEME_KEY,
  THEME_SCRIPT,
  applyTheme,
  colorScheme,
  currentTheme,
  readTheme,
  setTheme,
  type ThemeStore,
} from "./theme";

/** The two <meta name="theme-color"> tags Next writes from layout.tsx's viewport. */
function addThemeMetas() {
  for (const scheme of ["light", "dark"] as const) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.media = `(prefers-color-scheme: ${scheme})`;
    meta.content = THEME_COLOR[scheme];
    document.head.append(meta);
  }
}

function metaColors(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (m) => m.content,
  );
}

const blocked: ThemeStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

beforeEach(addThemeMetas);

afterEach(() => {
  setTheme("system");
  localStorage.clear();
  document.head.innerHTML = "";
});

describe("readTheme", () => {
  it("follows the system until a theme is kept, and ignores anything else", () => {
    expect(readTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "light");
    expect(readTheme()).toBe("light");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readTheme()).toBe("dark");
    localStorage.setItem(THEME_KEY, "sepia");
    expect(readTheme()).toBe("system");
    expect(readTheme(blocked)).toBe("system");
    expect(readTheme(null)).toBe("system");
  });
});

describe("colorScheme", () => {
  it("is the pick when there is one, else the device's setting", () => {
    expect(colorScheme("light", false)).toBe("light");
    expect(colorScheme("dark", true)).toBe("dark");
    expect(colorScheme("system", true)).toBe("light");
    expect(colorScheme("system", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("sets data-theme for a pick and clears it to follow the system", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(metaColors()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(metaColors()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    // Each tag goes back to its own scheme's colour.
    expect(metaColors()).toEqual([THEME_COLOR.light, THEME_COLOR.dark]);
  });
});

describe("setTheme", () => {
  it("keeps a pick, forgets it for Auto, applies it and tells the page", () => {
    let told = 0;
    const onChange = () => told++;
    window.addEventListener(THEME_CHANGED, onChange);
    setTheme("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(currentTheme()).toBe("light");
    setTheme("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(currentTheme()).toBe("system");
    expect(told).toBe(2);
    window.removeEventListener(THEME_CHANGED, onChange);
  });

  it("still applies for this visit when storage is blocked", () => {
    setTheme("dark", blocked);
    expect(currentTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("THEME_SCRIPT", () => {
  const run = () => new Function(THEME_SCRIPT)();

  it("applies the kept pick before the page paints, as applyTheme does", () => {
    localStorage.setItem(THEME_KEY, "light");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(metaColors()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);

    localStorage.setItem(THEME_KEY, "nonsense");
    run();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(metaColors()).toEqual([THEME_COLOR.light, THEME_COLOR.dark]);
  });

  it("follows another tab's pick and tells the page", () => {
    run();
    let told = 0;
    const onChange = () => told++;
    window.addEventListener(THEME_CHANGED, onChange);
    localStorage.setItem(THEME_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(told).toBeGreaterThan(0);
    // (Each run of the script in this file adds a listener; a page runs it once.)
    const after = told;
    window.dispatchEvent(new StorageEvent("storage", { key: "whereabout:units" }));
    expect(told).toBe(after);
    window.removeEventListener(THEME_CHANGED, onChange);
  });
});

/** WCAG relative luminance contrast between two hex colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The daylight set as globals.css declares it for `:root[data-theme="light"]`. */
function daylightTokens(): Record<string, string> {
  const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
  const block =
    css.match(
      /:root\[data-theme="light"\],\s*:root\[data-theme="light"\] \.wb-stage \{([^}]*)\}/,
    )?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

describe("the daylight colours", () => {
  const day = daylightTokens();

  it("are the same set whether picked or followed from the system", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const media =
      css.match(
        /:root:not\(\[data-theme="dark"\]\),\s*:root:not\(\[data-theme="dark"\]\) \.wb-stage \{([^}]*)\}/,
      )?.[1] ?? "";
    for (const [name, hex] of Object.entries(day))
      expect(media).toContain(`--color-${name}: ${hex}`);
    expect(Object.keys(day)).toHaveLength(8);
    expect(day.ocean.toLowerCase()).toBe(THEME_COLOR.light);
  });

  it("dress the globe stages too, while every night copy over a photo is the night chart", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const tokens = (block: string) =>
      Object.fromEntries(
        [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
      );
    const night = tokens(css.match(/@theme \{([^}]*)\}/)?.[1] ?? "");
    expect(Object.keys(night)).toHaveLength(8);
    // The stages' night block also holds their photo and the header while the photo shows …
    const stage = css.match(/\.wb-stage,\s*\.wb-night,([^{]*)\{([^}]*)\}/);
    expect(stage?.[1]).toContain(".wb-stage .wb-photo");
    expect(stage?.[1]).toContain('.wb-stage:not([data-phase="revealed"]) .wb-header');
    expect(tokens(stage?.[2] ?? "")).toEqual(night);
    // … and on a wide screen the guess bar floating over the photo.
    const bar = css.match(/\.wb-stage \.wb-guess-bar \{([^}]*)\}/)?.[1] ?? "";
    expect(tokens(bar)).toEqual(night);
  });

  it("keep every text pairing the night chart uses at 4.5:1 or better", () => {
    // Text and accents on the page and on panels.
    for (const fg of ["chalk", "chalk-dim", "flare", "sonar", "gold"]) {
      for (const bg of ["ocean", "ocean-deep"]) {
        expect(contrast(day[fg], day[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // An accent on its own tint (bg-sonar/10, bg-gold/20 …) over the page, as the Atlas
    // table's highlighted row and the quick games' verdicts use them.
    const mix = (fg: string, bg: string, t: number) =>
      "#" +
      [1, 3, 5]
        .map((i) => {
          const [f, b] = [parseInt(fg.slice(i, i + 2), 16), parseInt(bg.slice(i, i + 2), 16)];
          return Math.round(b * (1 - t) + f * t)
            .toString(16)
            .padStart(2, "0");
        })
        .join("");
    for (const accent of ["flare", "sonar", "gold"]) {
      for (const t of [0.05, 0.1, 0.15, 0.2]) {
        const tint = mix(day[accent], day.ocean, t);
        expect(
          contrast(day[accent], tint),
          `${accent} on ${accent}/${t * 100}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Words on an accent button or a chalk chip.
    for (const bg of ["chalk", "flare", "sonar", "gold"]) {
      for (const fg of ["ocean", "ocean-deep"]) {
        expect(contrast(day[fg], day[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
