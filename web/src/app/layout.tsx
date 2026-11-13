import type { Metadata, Viewport } from "next";
import ServiceWorker from "@/components/ServiceWorker";
import { THEME_COLOR, THEME_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Whereabout — can you beat the AI?",
  applicationName: "Whereabout",
  appleWebApp: { capable: true, title: "Whereabout", statusBarStyle: "black" },
  description:
    "Look at a photo, guess where in the world it was taken, and see if you can beat Atlas, an AI that reads the clues.",
};

export const viewport: Viewport = {
  // Each scheme's page background; lib/theme.ts swaps them when the player picks a theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The <head> script sets data-theme before the first paint, so React finds it already there.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
