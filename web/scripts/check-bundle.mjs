// Checks the static export's home page: the JavaScript it loads must not carry the photo
// catalog or Atlas's guesses (a game fetches its five records instead, src/lib/game/deck.ts).
// Prints the page's script sizes. Run after `npm run build`: node scripts/check-bundle.mjs [out]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const out = process.argv[2] ?? "out";
const html = readFileSync(join(out, "index.html"), "utf8");
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
if (scripts.length === 0) {
  console.error(`No scripts found in ${out}/index.html`);
  process.exit(1);
}

const catalog = JSON.parse(readFileSync("src/data/photos.json", "utf8"));
// Strings that appear only in the data files: every photo's Commons page.
const markers = catalog.map((p) => p.credit.sourceUrl);

let raw = 0;
let gzip = 0;
const leaks = [];
for (const src of scripts) {
  const file = join(out, src.startsWith(base) ? src.slice(base.length) : src);
  if (!existsSync(file)) {
    console.error(`Script ${src} is missing from ${out}`);
    process.exit(1);
  }
  const body = readFileSync(file);
  raw += body.length;
  gzip += gzipSync(body).length;
  const text = body.toString("utf8");
  const hits = markers.filter((m) => text.includes(m)).length;
  if (hits > 0) leaks.push(`${src}: ${hits} catalog photos`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Home page loads ${scripts.length} scripts: ${kb(raw)} (${kb(gzip)} gzipped)`);
if (leaks.length > 0) {
  console.error("The home page bundles the photo catalog:\n  " + leaks.join("\n  "));
  process.exit(1);
}
console.log("No catalog data in the home page's scripts.");
