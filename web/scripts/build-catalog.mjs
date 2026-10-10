// Converts data/curation/photos.csv into src/data/photos.json for the browser.
// Run: npm run catalog   (CI fails if the committed JSON is out of date; see catalog.test.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const csvPath = fileURLToPath(new URL("../../data/curation/photos.csv", import.meta.url));
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
  const catalog = toCatalog(readFileSync(csvPath, "utf8"));
  writeFileSync(outPath, JSON.stringify(catalog, null, 1) + "\n");
  console.log(`wrote ${catalog.length} photos to src/data/photos.json`);
}
