import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when test globals are enabled; unmount between tests.
afterEach(cleanup);

// Distances follow the browser's language region (`src/lib/units.ts`); jsdom says en-US, which
// reads in miles. Tests read kilometres unless they pick miles themselves.
if (typeof window !== "undefined") {
  Object.defineProperty(window.navigator, "languages", { value: ["en-AU"], configurable: true });
}
