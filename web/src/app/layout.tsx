import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whereabout — can you beat the AI?",
  description:
    "Look at a photo, guess where in the world it was taken, and see if you can beat Atlas, an AI that reads the clues.",
};

export const viewport: Viewport = {
  themeColor: "#0d3346",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
