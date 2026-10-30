import type { Metadata } from "next";
import Link from "next/link";

import PlayedMap from "@/components/PlayedMap";

export const metadata: Metadata = {
  title: "Your map — Whereabout",
  description:
    "Every photo you've played in Whereabout on one globe, coloured by how close your pin landed, with the countries you've seen. Kept only in your browser.",
};

export default function YourMapPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-10 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        Your map
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-chalk-dim">
        Every photo you&apos;ve played, where it was really taken, coloured by how close your pin
        landed. It stays in this browser and nowhere else.
      </p>
      <PlayedMap />
    </main>
  );
}
