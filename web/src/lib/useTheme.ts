"use client";

import { useSyncExternalStore } from "react";

import { LIGHT_QUERY, THEME_CHANGED, colorScheme, currentTheme, type ThemeChoice } from "./theme";

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

function lightQuery(): MediaQueryList | null {
  return typeof window === "undefined" ? null : (window.matchMedia?.(LIGHT_QUERY) ?? null);
}

function subscribeScheme(onChange: () => void): () => void {
  const unsubscribe = subscribe(onChange);
  const query = lightQuery();
  query?.addEventListener?.("change", onChange);
  return () => {
    unsubscribe();
    query?.removeEventListener?.("change", onChange);
  };
}

function schemeNow(): "light" | "dark" {
  return colorScheme(currentTheme(), !!lightQuery()?.matches);
}

/**
 * The scheme on screen right now, light or dark: the player's pick, else the device's setting,
 * followed live as either changes. For what CSS can't colour, like the globe's canvas.
 */
export function useColorScheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeScheme, schemeNow, () => "dark");
}
