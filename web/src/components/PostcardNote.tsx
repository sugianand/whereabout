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
 * credit ends its text, so it is never cut off for good. The Wikipedia link keeps to one line
 * beside "More" on a phone too, ending in an ellipsis when the article's title is long, and
 * "More" shows it whole; the link's name for screen readers is always the whole title.
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
  const linkRef = useRef<HTMLAnchorElement>(null);
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(false);

  // A new photo starts folded again.
  const [shownFor, setShownFor] = useState(postcard);
  if (shownFor !== postcard) {
    setShownFor(postcard);
    setExpanded(false);
  }

  // Whether the one-line cuts hide anything, the description's below or the link's beside,
  // measured whenever that could change: on a resize of the window or of the text itself.
  useBrowserLayoutEffect(() => {
    const text = textRef.current;
    const link = linkRef.current;
    if ((!text && !link) || expanded) return;
    const measure = () =>
      setCut(
        (!!text && text.scrollHeight > text.clientHeight + 1) ||
          (!!link && link.scrollWidth > link.clientWidth + 1),
      );
    measure();
    window.addEventListener("resize", measure);
    // A copy in a closed fold has no layout until the fold opens: measure it again then.
    const seen = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (text) seen?.observe(text);
    if (link) seen?.observe(link);
    return () => {
      window.removeEventListener("resize", measure);
      seen?.disconnect();
    };
  }, [description, article?.title, expanded]);

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
      {/* Each control here is 24 px tall to tap (py-1) without making the card taller (-my-1).
          On a phone the row stays one line until "More" opens it: a long title ends in "…". */}
      {(article || toggle) && (
        <p
          className={`mt-0.5 flex items-baseline gap-x-3 text-xs md:mt-1 md:flex-wrap ${expanded ? "flex-wrap" : ""}`}
        >
          {article && (
            <a
              ref={linkRef}
              href={article.url}
              target="_blank"
              rel="noreferrer"
              data-testid={`${testId}-article`}
              className={`-my-1 py-1 font-semibold text-gold underline decoration-gold/40 underline-offset-2 hover:decoration-gold ${expanded ? "" : "min-w-0 truncate md:overflow-visible md:whitespace-normal"}`}
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
              className="-my-1 shrink-0 py-1 font-semibold text-gold md:hidden"
            >
              {expanded ? "Less" : "More"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
