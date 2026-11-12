"use client";

import { useEffect, useId, useRef, useState } from "react";

import { answeredFrom, keepChallenge } from "@/lib/challengeLog";
import {
  HEAD_TO_HEAD_NOTE,
  headToHeadSummary,
  sendHeadToHead,
  type HeadToHead,
} from "@/lib/headToHead";

/**
 * Keep a friend's challenge that just ended in the head-to-head log on Your map
 * (`lib/challengeLog.ts`), once per result: the same link answered again replaces its entry.
 * `replyText` is read when the result is kept, so the rematch carries this game's own link.
 */
export function useKeepChallenge(headToHead: HeadToHead | null, replyText: () => string): void {
  const reply = useRef(replyText);
  useEffect(() => {
    reply.current = replyText;
  });
  const { game, outcome, youTotal, friendTotal } = headToHead ?? {};
  useEffect(() => {
    if (!headToHead) return;
    const entry = answeredFrom(headToHead, window.location.href, reply.current(), new Date());
    if (entry) keepChallenge(entry);
    // Kept again only when the result itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, outcome, youTotal, friendTotal]);
}

/**
 * *Share head to head* at the end of a friend's challenge in one of the quick games: draws both
 * results as a picture and sends it with the reply link (`replyText`, read as it is pressed, so the
 * link carries the page's address at that moment). `onNote` gets the line to show under the
 * buttons, so the game keeps one status line for every share it offers. `compact` is the smaller
 * size the answer cards use, where it shares a row with the button for a new run.
 */
export function HeadToHeadButton({
  headToHead,
  replyText,
  onNote,
  compact = false,
}: {
  headToHead: HeadToHead;
  replyText: () => string;
  onNote: (note: string) => void;
  compact?: boolean;
}) {
  const [drawing, setDrawing] = useState(false);
  const words = useId();
  useKeepChallenge(headToHead, replyText);

  async function share() {
    setDrawing(true);
    onNote(HEAD_TO_HEAD_NOTE.drawing);
    const outcome = await sendHeadToHead(headToHead, replyText());
    setDrawing(false);
    onNote(HEAD_TO_HEAD_NOTE[outcome]);
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        disabled={drawing}
        aria-describedby={words}
        className={`rounded-full border-2 border-gold font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-60 ${compact ? "px-4 py-2" : "px-5 py-2.5"}`}
      >
        Share head to head
      </button>
      <span id={words} hidden>
        {headToHeadSummary(headToHead)}
      </span>
    </>
  );
}
