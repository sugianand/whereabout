// Renders public/icons/icon.svg into the PNG icons the web app manifest and iOS use.
// Run by hand after changing the SVG (needs Playwright's Chromium): node scripts/build-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const targets = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
];

const browser = await chromium.launch();
for (const [path, size] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path, omitBackground: false });
  await page.close();
  console.log(`${path} (${size}px)`);
}
await browser.close();
