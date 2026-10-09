"use client";

import { useState } from "react";

import Globe from "@/components/Globe";
import type { LngLat } from "@/lib/geo";

/**
 * Holds the player's pin for the globe. The game loop (next roadmap step) takes over this
 * state and sends the pin to the API as the guess.
 */
export default function PinPicker() {
  const [pin, setPin] = useState<LngLat | null>(null);
  return (
    <section aria-labelledby="pin-heading" className="flex flex-col gap-3">
      <h2 id="pin-heading" className="font-sign text-2xl font-bold uppercase tracking-wide">
        Where was this taken?
      </h2>
      <Globe pin={pin} onPinChange={setPin} className="h-[min(70vh,560px)]" />
    </section>
  );
}
