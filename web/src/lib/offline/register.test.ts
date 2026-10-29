import { afterEach, describe, expect, it, vi } from "vitest";

import manifest from "@/app/manifest";

import { MAX_KEEP, keepForOffline, photoUrlsToKeep, workerUrl } from "./register";

const THUMB =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Big_Ben.jpg/1280px-Big_Ben.jpg";

describe("workerUrl", () => {
  it("serves the worker from the site root, scoped to the whole site", () => {
    expect(workerUrl("/whereabout")).toEqual({ script: "/whereabout/sw.js", scope: "/whereabout/" });
    expect(workerUrl("")).toEqual({ script: "/sw.js", scope: "/" });
  });
});

describe("photoUrlsToKeep", () => {
  it("keeps each photo at the size the frame asks for first, plus its blurred stand-in", () => {
    expect(photoUrlsToKeep([{ imageUrl: THUMB, width: 4000 }])).toEqual([
      THUMB,
      THUMB.replace("1280px-", "60px-"),
    ]);
    expect(photoUrlsToKeep([{ imageUrl: "https://example.org/p.jpg" }])).toEqual([
      "https://example.org/p.jpg",
    ]);
  });
});

describe("keepForOffline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the photos to the active worker once it is ready, without repeats", async () => {
    const postMessage = vi.fn();
    const ready = Promise.resolve({ active: { postMessage } });
    vi.stubGlobal("navigator", { serviceWorker: { ready } });
    keepForOffline(["a", "b", "a"]);
    await ready;
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: "keep", urls: ["a", "b"] });
  });

  it("asks for no more than one game's worth", async () => {
    const postMessage = vi.fn();
    const ready = Promise.resolve({ active: { postMessage } });
    vi.stubGlobal("navigator", { serviceWorker: { ready } });
    keepForOffline(Array.from({ length: 40 }, (_, i) => `u${i}`));
    await ready;
    await Promise.resolve();
    expect(postMessage.mock.calls[0][0].urls).toHaveLength(MAX_KEEP);
  });

  it("does nothing in browsers without service workers", () => {
    vi.stubGlobal("navigator", {});
    expect(() => keepForOffline(["a"])).not.toThrow();
  });
});

describe("the web app manifest", () => {
  const m = manifest();

  it("installs as a standalone app that opens on the game, under any base path", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("./");
    expect(m.scope).toBe("./");
    expect(m.short_name).toBe("Whereabout");
  });

  it("has the icon sizes Android asks for, including a maskable one, all relative", () => {
    const icons = m.icons ?? [];
    const sizes = icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
    for (const icon of icons) expect(icon.src).not.toMatch(/^\//);
  });
});
