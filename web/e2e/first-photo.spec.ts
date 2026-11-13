import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

// How soon the first photo is on screen on a phone with a slow connection, and that the globe's
// script (MapLibre, about a megabyte) waits for it instead of sharing the line.
//
// Throttling only slows real network traffic, not responses a test fulfils itself, so the photos
// come from a little HTTP server started here, on a path shaped like a Commons thumbnail so the
// game builds the same widths it would for Wikimedia. Each photo is the e2e stand-in padded to
// PHOTO_BYTES (image decoders ignore bytes after a PNG's end), so it costs the line what a real
// 1280px photo would; the 60px blur is the bare stand-in. The site's own pages and scripts come
// from the e2e server through the same throttled line. The time is reported, not asserted: it
// depends on the machine.

const STAND_IN = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const PHOTO_BYTES = 300_000;
const PHOTO = Buffer.concat([STAND_IN, Buffer.alloc(PHOTO_BYTES - STAND_IN.length)]);

// 1.6 Mbit/s down, 750 kbit/s up and 150 ms of latency: a slow phone connection.
const SLOW_PHONE = {
  offline: false,
  latency: 150,
  downloadThroughput: 1_600_000 / 8,
  uploadThroughput: 750_000 / 8,
};

const GLOBE_LOAD_MARK = "whereabout:globe-load";

let server: Server;
let photoHost = "";
const served: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    served.push(req.url ?? "");
    const tiny = /\/60px-/.test(req.url ?? "");
    res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    res.end(tiny ? STAND_IN : PHOTO);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  photoHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((done) => server.close(done));
});

test("on a slow phone connection the first photo comes before the globe's script", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "measured on the phone");
  test.setTimeout(120_000);
  served.length = 0;

  // Nothing reaches Wikimedia: every record's photo is moved to the local photo server.
  await page.route(/wikimedia\.org/, (route) => route.abort());
  await page.route(/\/game-data\//, async (route) => {
    const response = await route.fetch();
    const record = await response.json();
    record.photo.imageUrl = record.photo.imageUrl.replace(/^https:\/\/[^/]+/, photoHost);
    await route.fulfill({ response, json: record });
  });
  // The moment the photo covers its blur, in the page's own clock.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector('[data-photo-placeholder="covered"]')) {
        performance.mark("e2e:photo-shown");
        observer.disconnect();
      }
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_PHONE);

  await page.goto("./");
  await expect(page.locator('[data-photo-placeholder="covered"]')).toBeAttached({
    timeout: 60_000,
  });
  // The globe still arrives, after the photo.
  await expect(page.locator(".globe[data-ready]")).toBeAttached({ timeout: 60_000 });

  const timings = await page.evaluate((globeMark) => {
    const at = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? null;
    const photo = performance
      .getEntriesByType("resource")
      .find((e) => /\/\d+px-/.test(e.name) && !/\/60px-/.test(e.name)) as
      PerformanceResourceTiming | undefined;
    return {
      photoUrl: photo?.name ?? null,
      photoArrived: photo?.responseEnd ?? null,
      photoShown: at("e2e:photo-shown"),
      globeLoad: at(globeMark),
    };
  }, GLOBE_LOAD_MARK);

  const report = `first photo on screen ${Math.round(timings.photoShown ?? NaN)} ms after navigation; globe script asked for at ${Math.round(timings.globeLoad ?? NaN)} ms`;
  info.annotations.push({ type: "slow phone", description: report });
  console.log(`[slow phone] ${report}`);

  // The phone asked for the 1280px photo (412 CSS px at 2.625x is 1,082 px), once: the preload
  // and the <img> agreed on the width, so nothing was fetched twice.
  expect(timings.photoUrl).toMatch(/\/1280px-/);
  const big = served.filter((url) => !/\/60px-/.test(url));
  expect(big).toHaveLength(1);
  expect(big[0]).toMatch(/\/1280px-/);

  // The globe's script was not asked for until the photo had arrived and shown.
  expect(timings.photoShown).not.toBeNull();
  expect(timings.globeLoad).not.toBeNull();
  expect(timings.globeLoad!).toBeGreaterThanOrEqual(timings.photoArrived!);
});
