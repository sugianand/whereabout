"use client";

import { useSyncExternalStore } from "react";

import { UNITS_CHANGED, UNITS_KEY, currentUnits, type Units } from "./units";

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === UNITS_KEY || e.key === null) onChange();
  };
  window.addEventListener(UNITS_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UNITS_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The units to show, kept in step across every component and every tab. The static pages are
 * built in kilometres; hydration switches to the player's units straight away.
 */
export function useUnits(): Units {
  return useSyncExternalStore(subscribe, currentUnits, () => "km");
}
