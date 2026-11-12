"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { Postcard } from "@/lib/game/types";
import { isWikipediaUrl } from "@/lib/postcard";

// Server rendering has no layout to measure; the card only ever renders in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The reveal's postcard, under the place: the photo's Commons description, attributed to its
 * file page, and a link to read about the place on Wikipedia.
 *
 * Phones keep the card short enough to leave the answer in view, so a description longer than
 * one line is cut there with a "More" button; wider screens show it whole. The description's
 * credit ends its text, so it is never cut off for good.
 */
export default function PostcardNote({
  postcard,
  sourceUrl,
  className = "",
  testId = "postcard",
}: {
  postcard: Postcard;
  /** The photo's Commons file page, where the description comes from. */
  sourceUrl: string | null;
  className?: string;
  /** Tells a copy kept in the reveal's fold apart from the one under the place. */
  testId?: string;
}) {
  const { description } = postcard;
  // Only an English Wikipedia address is ever linked, whatever was stored.
  const article =
    postcard.article && isWikipediaUrl(postcard.article.url) ? postcard.article : undefined;
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(false);

  // A new photo starts folded again.
  const [shownFor, setShownFor] = useState(postcard);
  if (shownFor !== postcard) {
    setShownFor(postcard);
    setExpanded(false);
  }

  // Whether the one-line cut hides anything, measured whenever it could change: on a resize of
  // the window or of the text itself.
  useBrowserLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    // A copy in a closed fold has no layout until the fold opens: measure it again then.
    const seen = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    seen?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      seen?.disconnect();
    };
  }, [description, expanded]);

  if (!description && !article) return null;

  const toggle = cut || expanded;
  return (
    <div className={`mt-1.5 md:mt-2 ${className}`.trim()} data-testid={testId}>
      {description && (
        <p
          ref={textRef}
          id={textId}
          className={`text-xs leading-snug text-chalk md:text-sm ${expanded ? "" : "line-clamp-1 md:line-clamp-none"}`}
        >
          {description}
          {sourceUrl && (
            // The credit ends the text, so a cut description shows it with "More".
            <>
              {" "}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Description: Wikimedia Commons, CC BY-SA 4.0"
                className="whitespace-nowrap text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
              >
                Wikimedia Commons, CC BY-SA 4.0
              </a>
            </>
          )}
        </p>
      )}
      {/* Each control here is 24 px tall to tap (py-1) without making the card taller (-my-1). */}
      {(article || toggle) && (
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs md:mt-1">
          {article && (
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className="-my-1 py-1 font-semibold text-gold underline decoration-gold/40 underline-offset-2 hover:decoration-gold"
            >
              Read about {article.title} on Wikipedia
            </a>
          )}
          {toggle && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={textId}
              onClick={() => setExpanded((e) => !e)}
              className="-my-1 py-1 font-semibold text-gold md:hidden"
            >
              {expanded ? "Less" : "More"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
