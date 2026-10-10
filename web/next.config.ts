import type { NextConfig } from "next";

// The site is a static export: the Daily Five plays entirely in the browser, so it can be
// hosted for free on GitHub Pages (docs/decisions/0002-static-demo-mode.md).
// NEXT_PUBLIC_BASE_PATH is "/whereabout" on GitHub Pages and empty everywhere else.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
