import { describe, expect, it } from "vitest";

import {
  MAX_PHOTOS,
  cacheNames,
  classify,
  pageFallback,
  photoKey,
  photoStandIn,
  photoWidth,
  photosToDrop,
  precacheList,
} from "./cacheRules";

const ORIGIN = "https://sugianand.github.io";
const kind = (path: string, base = "/whereabout") => classify(new URL(path, ORIGIN), ORIGIN, base);

// Thumbnails come from thumb.wikimedia.org, originals from upload.wikimedia.org.
const THUMB = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Big_Ben.jpg";
const at = (w: number) => `${THUMB}/${w}px-Big_Ben.jpg`;
const ORIGINAL = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Big_Ben.jpg";

describe("classify", () => {
  it("serves the build's hashed files, icons and the MapLibre worker cache first", () => {
    expect(kind("/whereabout/_next/static/chunks/0abc.js")).toBe("static");
    expect(kind("/whereabout/vendor/maplibre-gl-worker-6.13.0.mjs")).toBe("static");
    expect(kind("/whereabout/icons/icon-192.png")).toBe("static");
    expect(kind("/whereabout/icon.svg?icon.123.svg")).toBe("static");
    expect(kind("/whereabout/manifest.webmanifest")).toBe("static");
  });

  it("keeps game records apart from pages", () => {
    expect(kind("/whereabout/game-data/1a2b3c4d/wm000.json")).toBe("record");
    expect(kind("/whereabout/")).toBe("page");
    expect(kind("/whereabout/streak/?region=europe")).toBe("page");
    expect(kind("/whereabout/index.txt?_rsc=x")).toBe("page");
  });

  it("leaves the worker itself, Pocket Atlas and other sites alone", () => {
    expect(kind("/whereabout/sw.js")).toBe("pass");
    expect(kind("/whereabout/pocket-atlas/vectors.bin")).toBe("pass");
    expect(kind("/other-site/")).toBe("pass");
    expect(classify(new URL("https://huggingface.co/x/model.onnx"), ORIGIN, "")).toBe("pass");
  });

  it("works without a base path", () => {
    expect(kind("/", "")).toBe("page");
    expect(kind("/game-data/v/wm000.json", "")).toBe("record");
    expect(kind("/_next/static/x.css", "")).toBe("static");
  });

  it("treats Wikimedia photos as photos", () => {
    expect(classify(new URL(at(1280)), ORIGIN, "/whereabout")).toBe("photo");
    expect(classify(new URL(ORIGINAL), ORIGIN, "/whereabout")).toBe("photo");
    expect(classify(new URL("https://commons.wikimedia.org/wiki/File:Big_Ben.jpg"), ORIGIN, "")).toBe(
      "pass",
    );
  });
});

describe("photos", () => {
  it("gives every size of one photo the same key", () => {
    expect(photoKey(at(60))).toBe("a/ab/Big_Ben.jpg");
    expect(photoKey(at(1280))).toBe("a/ab/Big_Ben.jpg");
    expect(photoKey(ORIGINAL)).toBe("a/ab/Big_Ben.jpg");
    expect(photoKey(at(1280).replace("thumb.", "upload."))).toBe("a/ab/Big_Ben.jpg");
    expect(photoKey(at(1280).replace("Big_Ben", "Tower"))).not.toBe(photoKey(at(1280)));
    expect(photoKey("https://example.org/a/ab/Big_Ben.jpg")).toBeNull();
  });

  it("reads the width a URL asks for", () => {
    expect(photoWidth(at(1920))).toBe(1920);
    expect(photoWidth(ORIGINAL)).toBe(Number.POSITIVE_INFINITY);
  });

  it("stands in the widest cached copy of the same photo, and nothing else", () => {
    const other = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Eiffel.jpg/3840px-Eiffel.jpg";
    expect(photoStandIn(at(1920), [at(60), at(1280), other])).toBe(at(1280));
    expect(photoStandIn(at(60), [at(1280), ORIGINAL])).toBe(ORIGINAL);
    expect(photoStandIn(at(1920), [other])).toBeNull();
    expect(photoStandIn("https://example.org/x.jpg", [at(1280)])).toBeNull();
  });

  it("drops the oldest photos beyond the limit", () => {
    const urls = Array.from({ length: MAX_PHOTOS + 3 }, (_, i) => `u${i}`);
    expect(photosToDrop(urls)).toEqual(["u0", "u1", "u2"]);
    expect(photosToDrop(["a", "b"], 5)).toEqual([]);
  });
});

describe("pageFallback", () => {
  const pages = ["/whereabout/", "/whereabout/streak/", "/whereabout/you/"];
  const url = (p: string) => new URL(p, ORIGIN);

  it("serves the same page whatever its query", () => {
    expect(pageFallback(url("/whereabout/streak/?region=asia"), "/whereabout", pages)).toBe(
      "/whereabout/streak/",
    );
    expect(pageFallback(url("/whereabout/?daily"), "/whereabout", pages)).toBe("/whereabout/");
    expect(pageFallback(url("/whereabout/you"), "/whereabout", pages)).toBe("/whereabout/you/");
  });

  it("falls back to the home page, or nothing when even that is missing", () => {
    expect(pageFallback(url("/whereabout/atlas/"), "/whereabout", pages)).toBe("/whereabout/");
    expect(pageFallback(url("/whereabout/atlas/"), "/whereabout", [])).toBeNull();
  });
});

describe("precacheList", () => {
  const home = `<html><head>
    <link rel="stylesheet" href="/whereabout/_next/static/chunks/a.css"/>
    <link rel="icon" href="/whereabout/icon.svg?icon.1.svg"/>
    <link rel="preload" href="/whereabout/_next/static/media/font.woff2" as="font"/>
    </head><body><script src="/whereabout/_next/static/chunks/b.js"></script>
    <a href="/whereabout/streak/">Streak</a><img src="https://upload.wikimedia.org/x.jpg"/>
    <script src="/whereabout/_next/static/chunks/b.js"></script></body></html>`;

  it("takes every page and the shell files its HTML loads, once each", () => {
    const list = precacheList(
      { "/": home, "/streak/": '<script src="/whereabout/_next/static/chunks/c.js"></script>' },
      "/whereabout",
      ["/manifest.webmanifest"],
    );
    expect(list).toEqual([
      "/whereabout/",
      "/whereabout/_next/static/chunks/a.css",
      "/whereabout/_next/static/chunks/b.js",
      "/whereabout/_next/static/chunks/c.js",
      "/whereabout/_next/static/media/font.woff2",
      "/whereabout/icon.svg?icon.1.svg",
      "/whereabout/manifest.webmanifest",
      "/whereabout/streak/",
    ]);
  });

  it("works without a base path", () => {
    expect(precacheList({ "/": '<script src="/_next/static/x.js"></script>' }, "")).toEqual([
      "/",
      "/_next/static/x.js",
    ]);
  });
});

describe("cacheNames", () => {
  it("names the shell caches after the build and the records after their version", () => {
    const names = cacheNames("b1", "v1");
    expect(names.static).toBe("whereabout-static-b1");
    expect(names.pages).toBe("whereabout-pages-b1");
    expect(names.records).toBe("whereabout-records-v1");
    expect(names.photos).toBe("whereabout-photos");
  });
});
