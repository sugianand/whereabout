import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { maplibreWorkerUrl } from "./maplibre-worker";

describe("maplibreWorkerUrl", () => {
  it("points at the versioned copy in public/vendor", () => {
    expect(maplibreWorkerUrl("6.13.0")).toBe("/vendor/maplibre-gl-worker-6.13.0.mjs");
  });

  it("rejects anything that is not a version, so it can never build a path outside vendor/", () => {
    expect(() => maplibreWorkerUrl("../../etc")).toThrow();
    expect(() => maplibreWorkerUrl("")).toThrow();
  });

  it("matches a file MapLibre actually ships", () => {
    expect(existsSync(join("node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"))).toBe(
      true,
    );
  });

  it("prefixes the site's base path when it is served from a subfolder", () => {
    expect(maplibreWorkerUrl("6.13.0", "/whereabout")).toBe(
      "/whereabout/vendor/maplibre-gl-worker-6.13.0.mjs",
    );
    expect(maplibreWorkerUrl("6.13.0", "/whereabout/")).toBe(
      "/whereabout/vendor/maplibre-gl-worker-6.13.0.mjs",
    );
  });
});
