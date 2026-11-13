"use client";

import { useSyncExternalStore } from "react";

import { THEME_CHANGED, currentTheme, type ThemeChoice } from "./theme";

function subscribe(onChange: () => void): () => void {
  // The <head> script re-applies another tab's choice and re-sends THEME_CHANGED for it.
  window.addEventListener(THEME_CHANGED, onChange);
  return () => window.removeEventListener(THEME_CHANGED, onChange);
}

/**
 * The theme the player picked, kept in step across every switch and every tab. The static pages
 * are built following the system; hydration shows the kept choice straight away.
 */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, currentTheme, () => "system");
}
