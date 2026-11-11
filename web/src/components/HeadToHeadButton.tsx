"use client";

import { useId, useState } from "react";

import {
  HEAD_TO_HEAD_NOTE,
  headToHeadSummary,
  sendHeadToHead,
  type HeadToHead,
} from "@/lib/headToHead";

/**
 * *Share head to head* at the end of a friend's challenge in one of the quick games: draws both
 * results as a picture and sends it with the reply link (`replyText`, read as it is pressed, so the
 * link carries the page's address at that moment). `onNote` gets the line to show under the
 * buttons, so the game keeps one status line for every share it offers.
 */
export function HeadToHeadButton({
  headToHead,
  replyText,
  onNote,
}: {
  headToHead: HeadToHead;
  replyText: () => string;
  onNote: (note: string) => void;
}) {
  const [drawing, setDrawing] = useState(false);
  const words = useId();

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
        className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-60"
      >
        Share head to head
      </button>
      <span id={words} hidden>
        {headToHeadSummary(headToHead)}
      </span>
    </>
  );
}
