import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { gateOf, screen } from "../src/lib/pocket/gate";
import { decodeIndex, locate, temperatureOf, type PocketMeta } from "../src/lib/pocket/locate";

/**
 * Does the browser's Atlas see what PyTorch's Atlas sees?
 *
 * Runs only with POCKET_PARITY_IMAGE set (the Atlas workflow sets it), because it downloads the
 * real model from the Hugging Face Hub. It uploads the same photo whose PyTorch embedding the
 * index stores, and compares the embedding transformers.js computes in Chromium.
 */
const image = process.env.POCKET_PARITY_IMAGE;
const MIN_COSINE = 0.95;

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    dot += x * b[i];
    na += x * x;
    nb += b[i] * b[i];
  });
  return dot / Math.sqrt(na * nb);
}

test("Pocket Atlas in the browser agrees with PyTorch", async ({ page }, info) => {
  test.skip(!image, "set POCKET_PARITY_IMAGE to run (downloads the model weights)");
  test.skip(info.project.name !== "desktop", "one browser is enough for parity");
  test.setTimeout(10 * 60_000);

  const meta = JSON.parse(readFileSync("public/pocket-atlas/index.json", "utf8")) as PocketMeta;
  expect(meta.parity, "index.json has no parity embedding").toBeTruthy();
  const parity = meta.parity!;

  // The site's own locate(), temperature included, on PyTorch's embedding gives PyTorch's guess.
  const index = decodeIndex(meta, new Int8Array(readFileSync("public/pocket-atlas/vectors.bin")));
  const port = locate(index, parity.embedding);
  expect([port.city, port.country]).toEqual([parity.guess.city, parity.guess.country]);
  expect(port.confidence).toBeCloseTo(parity.guess.confidence, 3);
  port.topCountries.forEach((c, i) => expect(c.p).toBeCloseTo(parity.guess.topCountries[i].p, 3));
  // And the site's privacy gate scores PyTorch's embedding as Python does. The parity photo is a
  // hand-reviewed catalog photo, one of those that set the gate's bars, so it must pass.
  const gate = gateOf(meta);
  expect(gate, "index.json has no privacy gate").toBeTruthy();
  const portGate = screen(gate!, parity.embedding);
  expect(portGate.reasons).toEqual(parity.gate?.reasons);
  for (const [r, want] of Object.entries(parity.gate?.scores ?? {})) {
    expect(portGate.scores[r as keyof typeof portGate.scores]).toBeCloseTo(want, 2);
  }
  expect(portGate.passed).toBe(true);

  await page.goto("you");
  await page.setInputFiles('input[type="file"]', image!);
  await page.waitForFunction(() => window.__pocketAtlas, undefined, { timeout: 9 * 60_000 });
  const got = await page.evaluate(() => window.__pocketAtlas!);

  const similarity = cosine(got.embedding, parity.embedding);
  const report = {
    cosine: Math.round(similarity * 10000) / 10000,
    temperature: temperatureOf(meta),
    browser: got.guess,
    pytorch: parity.guess,
    sameCountry: got.guess?.country === parity.guess.country,
    sameCity: got.guess?.city === parity.guess.city,
    gate: { browser: got.gate, pytorch: parity.gate },
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/pocket-parity.json", JSON.stringify(report, null, 2));
  console.log(`pocket parity: ${JSON.stringify(report)}`);

  expect(similarity).toBeGreaterThanOrEqual(MIN_COSINE);
  // The browser's 8-bit model can move a score that sits right at a bar, so its verdict is
  // reported rather than required; whichever it is, the page must show it.
  if (got.guess) {
    await expect(page.getByRole("heading", { name: got.guess.city })).toBeVisible();
  } else {
    await expect(page.getByTestId("pocket-declined")).toBeVisible();
  }
});
