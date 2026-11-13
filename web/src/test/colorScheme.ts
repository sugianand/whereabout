import { vi } from "vitest";

/**
 * A stand-in for the system's light or dark setting, which jsdom lacks: `matchMedia` answers
 * `(prefers-color-scheme: light)` with `light`, and `set` flips it and tells every listener, as a
 * phone does when it turns dark at sunset.
 */
export function stubColorScheme(light: boolean) {
  const listeners = new Set<() => void>();
  const state = { light };
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return query.includes("light") ? state.light : false;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    set(next: boolean) {
      state.light = next;
      for (const fn of listeners) fn();
    },
  };
}
