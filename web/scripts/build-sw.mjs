// Builds the service worker (src/sw/sw.ts) into out/sw.js after `next build`.
//
// It fills in what the worker precaches when it installs: every page of the static export and
// the scripts, styles and icons those pages load (precacheList in src/lib/offline/cacheRules.ts),
// plus every script chunk, the fonts, the MapLibre worker and the app icons: the whole app
// shell, so an offline reload has everything but the photos (which the game keeps as it deals). The worker's caches are named after a hash of
// those files, so a new build replaces the old copies and an unchanged one keeps them.
//   node scripts/build-sw.mjs [out]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(webRoot, process.argv[2] ?? "out");
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const SKIP_PAGES = new Set(["/404/", "/_not-found/"]);

if (!existsSync(join(out, "index.html"))) {
  console.error(`No static export in ${out}: run next build first`);
  process.exit(1);
}

// The precache rules are TypeScript; compile them in memory to share them with the worker.
const rules = await build({
  entryPoints: [join(webRoot, "src/lib/offline/cacheRules.ts")],
  bundle: true,
  format: "esm",
  write: false,
});
const { precacheList } = await import(
  `data:text/javascript,${encodeURIComponent(rules.outputFiles[0].text)}`
);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const htmlByPage = {};
for (const file of walk(out)) {
  if (!file.endsWith(`${sep}index.html`)) continue;
  const page = `/${relative(out, dirname(file)).split(sep).join("/")}/`.replace(/^\/\/$/, "/");
  if (!SKIP_PAGES.has(page)) htmlByPage[page] = readFileSync(file, "utf8");
}

// Beyond what the HTML names: every script chunk (the globe and the result screens load theirs
// lazily, and an offline reload must still find them), the fonts and MapLibre's stylesheet. Not
// the copies of MapLibre's own modules Turbopack also emits; the game runs MapLibre from its
// chunk and its worker from vendor/.
const extra = ["/manifest.webmanifest", "/apple-icon.png"];
for (const dir of ["icons", "vendor", "_next/static/chunks"]) {
  for (const name of readdirSync(join(out, dir))) extra.push(`/${dir}/${name}`);
}
for (const name of readdirSync(join(out, "_next/static/media"))) {
  if (/\.(woff2|css)$/.test(name)) extra.push(`/_next/static/media/${name}`);
}

const precache = precacheList(htmlByPage, base, extra);
const hash = createHash("sha256");
for (const url of precache) {
  let path = url.slice(base.length).split("?")[0];
  if (path.endsWith("/")) path += "index.html";
  const file = join(out, path);
  if (!existsSync(file)) {
    console.error(`Precached ${url} is missing from ${out}`);
    process.exit(1);
  }
  hash.update(url).update(readFileSync(file));
}
const buildId = hash.digest("hex").slice(0, 12);

const versions = readdirSync(join(out, "game-data"));
if (versions.length !== 1) {
  console.error(`Expected one game-data version in ${out}, found ${versions.join(", ")}`);
  process.exit(1);
}

await build({
  entryPoints: [join(webRoot, "src/sw/sw.ts")],
  outfile: join(out, "sw.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  alias: { "@": join(webRoot, "src") },
  define: {
    __BUILD__: JSON.stringify(buildId),
    __BASE__: JSON.stringify(base),
    __RECORDS_VERSION__: JSON.stringify(versions[0]),
    __PRECACHE__: JSON.stringify(precache),
  },
  logLevel: "warning",
});
console.log(`sw.js: build ${buildId}, ${precache.length} files precached, ${Object.keys(htmlByPage).length} pages`);
