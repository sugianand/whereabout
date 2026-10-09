// Copies MapLibre's web worker into public/ so the browser can load it.
//
// MapLibre GL 6 ships its tile worker as a separate ES module that it locates relative to
// its own file. Bundlers rename and relocate that file, so the lookup fails ("Worker failed
// to load"). We serve the worker ourselves under a versioned name and point MapLibre at it
// with setWorkerUrl() (see src/lib/maplibre-worker.ts). Runs before `dev` and `build`.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));

const source = join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs");
const targetDir = join(webRoot, "public", "vendor");
const target = join(targetDir, `maplibre-gl-worker-${version}.mjs`);

mkdirSync(targetDir, { recursive: true });
// Drop workers left over from earlier MapLibre versions.
for (const name of readdirSync(targetDir)) {
  if (name.startsWith("maplibre-gl-worker-") && join(targetDir, name) !== target) {
    rmSync(join(targetDir, name));
  }
}
copyFileSync(source, target);
console.log(`maplibre worker ${version} -> public/vendor/`);
