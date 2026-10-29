import type { MetadataRoute } from "next";

import { MAP_COLORS } from "@/lib/basemap";

// Makes the game installable on phones ("Add to Home screen") and desktops. Every URL here is
// relative to the manifest itself, so it works under any base path (/whereabout on GitHub Pages).
// The service worker that lets an installed game play on without a connection is src/sw/sw.ts.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "./",
    name: "Whereabout — can you beat the AI?",
    short_name: "Whereabout",
    description:
      "Look at a photo, guess where in the world it was taken, and see if you can beat Atlas, an AI that reads the clues.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: MAP_COLORS.space,
    theme_color: MAP_COLORS.ocean,
    categories: ["games", "education"],
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
