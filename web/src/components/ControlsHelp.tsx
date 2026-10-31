"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { CONTROLS, SCREEN_TITLES, isShortcut, type HelpScreen } from "@/lib/controls";

/**
 * The `?` help: a small button, and the `?` key from anywhere on the screen, open one sheet
 * listing every control of the screen in view (`CONTROLS` in `lib/controls.ts`).
 *
 * On a keyboard-and-mouse screen each row shows its keys and its click; on a touch screen
 * (no hover, a coarse pointer) the keys give way to the gesture, from CSS alone, so the sheet
 * reads right before hydration and in a phone with a keyboard attached it still lists clicks.
 *
 * While the sheet is open its own key presses stop at it, so the screen's shortcuts (1 and 2 in
 * Further North, H for a hint) never act behind it; Esc, the close button or a tap outside close
 * it and give focus back to where it was.
 */
export default function ControlsHelp({ screen }: { screen: HelpScreen }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const show = useCallback(() => {
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnTo.current?.focus({ preventScroll: true });
    returnTo.current = null;
  }, []);

  // `?` opens the sheet from anywhere on the screen, unless the player is typing.
  useEffect(() => {
    if (open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "?" || !isShortcut(e)) return;
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show]);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  function onSheetKey(e: KeyboardEvent<HTMLDivElement>) {
    // Nothing pressed in the sheet reaches the screen's own shortcuts on the window.
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // The close button is the sheet's one control: focus stays on it.
      e.preventDefault();
      closeRef.current?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Controls"
        title="Controls (?)"
        className="pointer-events-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-chalk/30 bg-ocean-deep/60 text-xs font-bold text-chalk backdrop-blur transition hover:border-chalk"
      >
        ?
      </button>
      {open && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-ocean-deep/70 p-0 backdrop-blur-sm md:items-center md:p-6"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onSheetKey}
            className="wb-help max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-graticule/70 bg-ocean-deep p-4 text-left text-chalk shadow-2xl md:rounded-2xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="font-sign text-2xl font-extrabold leading-tight">
                {SCREEN_TITLES[screen]}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="shrink-0 rounded-full border border-chalk/30 px-3 py-1 text-sm font-semibold transition hover:border-chalk"
              >
                Close
              </button>
            </div>
            {CONTROLS[screen].map((group) => (
              <div key={group.title} role="group" className="mt-4" aria-label={group.title}>
                <h3 className="text-sm font-semibold text-gold">{group.title}</h3>
                {group.focus && (
                  <p className="wb-help-keys text-xs text-chalk-dim">{`Keys: ${group.focus}.`}</p>
                )}
                <ul className="mt-1 divide-y divide-graticule/50">
                  {group.controls.map((control) => (
                    <li
                      key={control.id}
                      data-control={control.id}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0">{control.does}</span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                        {control.keys.length > 0 && (
                          <span className="wb-help-keys flex flex-wrap justify-end gap-1">
                            {control.keys.map((key) => (
                              <kbd
                                key={key.label}
                                className="min-w-6 rounded border border-chalk/40 bg-chalk/10 px-1.5 text-center font-sans text-xs"
                              >
                                {key.label}
                              </kbd>
                            ))}
                          </span>
                        )}
                        <span className="wb-help-mouse text-xs text-chalk-dim">
                          {control.mouse}
                        </span>
                        <span className="wb-help-touch text-xs text-chalk-dim">
                          {control.touch}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
