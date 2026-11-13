"use client";

import { THEME_NAME, THEME_ORDER, setTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

/**
 * A three-way switch for the site's colours: Auto follows the system's light or dark setting,
 * Light and Dark hold one. The choice is kept in this browser and applies at once, everywhere.
 */
export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const theme = useTheme();
  return (
    <div
      role="group"
      aria-label="Colours"
      className={`inline-flex shrink-0 overflow-hidden rounded-full border border-chalk/30 text-xs ${className}`}
    >
      {THEME_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          title={
            t === "system"
              ? "Follow this device's light or dark setting"
              : `Always ${THEME_NAME[t].toLowerCase()}`
          }
          onClick={() => setTheme(t)}
          className={`min-h-6 px-2.5 font-semibold transition ${
            theme === t ? "bg-chalk text-ocean-deep" : "text-chalk-dim hover:text-chalk"
          }`}
        >
          {THEME_NAME[t]}
        </button>
      ))}
    </div>
  );
}
