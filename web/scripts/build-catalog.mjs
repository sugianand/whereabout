// Converts data/curation/photos.csv into src/data/photos.json for the browser.
// Run: npm run catalog   (CI fails if the committed JSON is out of date; see catalog.test.ts)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const csvPath = fileURLToPath(new URL("../../data/curation/photos.csv", import.meta.url));
const qualityPath = fileURLToPath(new URL("../../data/curation/quality.csv", import.meta.url));
const outPath = fileURLToPath(new URL("../src/data/photos.json", import.meta.url));

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parses quality.csv (id,width,height,sharpness,sharpness_global) into Map<id, {width, height}>. */
export function parseQuality(text) {
  const [header = [], ...body] = parseCsv(text);
  const map = new Map();
  for (const cells of body) {
    const r = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    const width = Number(r.width);
    const height = Number(r.height);
    if (r.id && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      map.set(r.id, { width, height });
    }
  }
  return map;
}

/** Adds original width/height to each entry whose id is in the quality CSV text (if any). */
export function joinQuality(catalog, qualityText) {
  if (qualityText == null) return catalog;
  const quality = parseQuality(qualityText);
  return catalog.map((p) => {
    const q = quality.get(p.id);
    return q ? { ...p, width: q.width, height: q.height } : p;
  });
}

/** Builds the catalog from photos.csv text, joined with quality.csv text when given. */
export function buildCatalog(photosText, qualityText) {
  return joinQuality(toCatalog(photosText), qualityText);
}

export function toCatalog(text) {
  const [header, ...body] = parseCsv(text);
  return body.map((cells) => {
    const r = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    return {
      id: r.id,
      imageUrl: r.image_url,
      lng: Number(r.lon),
      lat: Number(r.lat),
      place: r.place,
      country: r.country,
      credit: { author: r.author, license: r.license, sourceUrl: r.source_url },
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const catalog = buildCatalog(
    readFileSync(csvPath, "utf8"),
    existsSync(qualityPath) ? readFileSync(qualityPath, "utf8") : null,
  );
  writeFileSync(outPath, JSON.stringify(catalog, null, 1) + "\n");
  console.log(`wrote ${catalog.length} photos to src/data/photos.json`);
}
