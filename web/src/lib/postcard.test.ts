// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  POSTCARD_MAX_CHARS as BUILD_MAX,
  WIKIPEDIA_URL as BUILD_URL,
} from "../../scripts/build-catalog.mjs";
import { POSTCARD_MAX_CHARS, isPostcard, isWikipediaUrl } from "./postcard";

const ARTICLE = { title: "Ulaanbaatar", url: "https://en.wikipedia.org/wiki/Ulaanbaatar" };

describe("isWikipediaUrl", () => {
  it("accepts English Wikipedia articles only", () => {
    expect(isWikipediaUrl("https://en.wikipedia.org/wiki/Nyk%C3%B6ping")).toBe(true);
    expect(isWikipediaUrl("https://en.wikipedia.org/wiki/Qal%27at_al-Bahrain")).toBe(true);
    expect(isWikipediaUrl("http://en.wikipedia.org/wiki/Porto")).toBe(false);
    expect(isWikipediaUrl("https://de.wikipedia.org/wiki/Porto")).toBe(false);
    expect(isWikipediaUrl("https://en.wikipedia.org.evil.example/wiki/Porto")).toBe(false);
    expect(isWikipediaUrl("https://en.wikipedia.org/wiki/")).toBe(false);
    expect(isWikipediaUrl("javascript:alert(1)")).toBe(false);
    expect(isWikipediaUrl(42)).toBe(false);
  });

  it("matches the rule the catalog build applies", () => {
    expect(BUILD_MAX).toBe(POSTCARD_MAX_CHARS);
    for (const url of [
      "https://en.wikipedia.org/wiki/Porto",
      "https://de.wikipedia.org/wiki/Porto",
      'https://en.wikipedia.org/wiki/a"b',
      "https://en.wikipedia.org/wiki/a b",
    ]) {
      expect(BUILD_URL.test(url), url).toBe(isWikipediaUrl(url));
    }
  });
});

describe("isPostcard", () => {
  it("accepts a description, an article or both", () => {
    expect(isPostcard({ description: "A monastery on a hill." })).toBe(true);
    expect(isPostcard({ article: ARTICLE })).toBe(true);
    expect(isPostcard({ description: "A monastery on a hill.", article: ARTICLE })).toBe(true);
    expect(isPostcard({ description: "x".repeat(POSTCARD_MAX_CHARS) })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPostcard(null)).toBe(false);
    expect(isPostcard([])).toBe(false);
    expect(isPostcard({})).toBe(false);
    expect(isPostcard({ description: "  " })).toBe(false);
    expect(isPostcard({ description: "x".repeat(POSTCARD_MAX_CHARS + 1) })).toBe(false);
    expect(isPostcard({ description: 7 })).toBe(false);
    expect(isPostcard({ article: { ...ARTICLE, title: "" } })).toBe(false);
    expect(isPostcard({ article: { ...ARTICLE, url: "https://example.org/" } })).toBe(false);
    expect(isPostcard({ article: "Ulaanbaatar" })).toBe(false);
    expect(isPostcard({ article: ARTICLE, extra: true })).toBe(false);
  });
});
