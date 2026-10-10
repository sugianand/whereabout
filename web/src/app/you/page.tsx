import type { Metadata } from "next";
import Link from "next/link";

import PocketAtlas from "@/components/PocketAtlas";

export const metadata: Metadata = {
  title: "Test Atlas on your own photo — Whereabout",
  description:
    "Give Atlas a photo of yours and watch it guess where it was taken, right in your browser. Your photo never leaves your device.",
};

export default function YourPhotoPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-10 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-12 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        Test Atlas on your photo
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-chalk-dim">
        This is Pocket Atlas: a smaller version of the AI you play against, small enough to run
        inside your browser. Give it a holiday photo and see if it can tell where you were.
      </p>
      <PocketAtlas />
      <p className="mt-16 max-w-2xl text-sm text-chalk-dim">
        Pocket Atlas uses CLIP ViT-B/32, which is less accurate than the larger model in the game.{" "}
        <Link href="/atlas" className="underline underline-offset-2 hover:text-chalk">
          How Atlas guesses, and how often it&apos;s right
        </Link>
        .
      </p>
    </main>
  );
}
