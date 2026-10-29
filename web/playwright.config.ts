import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the static export, served under the same base path as
// GitHub Pages. Build first: NEXT_PUBLIC_BASE_PATH=/whereabout npm run build
const PORT = 4173;

// Lets context.route() and setOffline() reach the service worker's own requests, so the offline
// test (e2e/offline.spec.ts) cuts the worker off too and its photos never come from Wikimedia.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const BASE = "/whereabout";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}${BASE}/`,
    trace: "retain-on-failure",
    // The offline service worker would answer requests before page.route() sees them, so it is
    // off for every test except e2e/offline.spec.ts, which tests it.
    serviceWorkers: "block",
    launchOptions: {
      // Software WebGL, so the globe renders on machines without a GPU.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node scripts/serve-static.mjs ${PORT}`,
    env: { BASE_PATH: BASE },
    url: `http://localhost:${PORT}${BASE}/`,
    reuseExistingServer: !process.env.CI,
  },
});
