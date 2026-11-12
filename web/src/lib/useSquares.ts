"use client";

import { useSyncExternalStore } from "react";

import { SQUARES_CHANGED, SQUARES_KEY, currentSquares, type SquareSet } from "./squares";

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SQUARES_KEY || e.key === null) onChange();
  };
  window.addEventListener(SQUARES_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SQUARES_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The share squares to show, kept in step across every component and every tab. The static pages
 * are built in the classic set; hydration switches to the player's set straight away.
 */
export function useSquares(): SquareSet {
  return useSyncExternalStore(subscribe, currentSquares, () => "classic");
}
