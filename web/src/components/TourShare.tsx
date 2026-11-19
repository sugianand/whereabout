"use client";

import { useId, useState } from "react";

import type { Continent } from "@/lib/continents";
import { sendShare, type ShareOutcome } from "@/lib/share";
import { clearedCount, type TourRecord } from "@/lib/tour";
import {
  TOUR_SHARE_NOTE,
  sendTourShare,
  tourShareCard,
  tourShareSummary,
  tourShareText,
} from "@/lib/tourShare";

const TEXT_NOTE: Record<ShareOutcome, string> = {
  shared: "Tour shared.",
  copied: "Tour copied. Paste it anywhere.",
  cancelled: "",
  failed: "Couldn't copy. Your browser blocked the clipboard.",
};

/**
 * Share your World Tour: *Share your tour* draws the route with each leg's best game against
 * Atlas and sends it with the counts and a link to the tour; *Share as text* sends the line
 * alone. The tour keeps no photos, so neither can name one (`lib/tourShare.ts`).
 */
export default function TourShare({
  route,
  record,
}: {
  route: readonly Continent[];
  record: TourRecord;
}) {
  const [drawing, setDrawing] = useState(false);
  const [note, setNote] = useState("");
  const words = useId();
  const card = () => tourShareCard(route, record, window.location.href);

  async function sharePicture() {
    setDrawing(true);
    setNote(TOUR_SHARE_NOTE.drawing);
    const outcome = await sendTourShare(card());
    setDrawing(false);
    setNote(TOUR_SHARE_NOTE[outcome]);
  }

  async function shareText() {
    setNote(TEXT_NOTE[await sendShare(tourShareText(card()), navigator)]);
  }

  return (
    <div className="mt-5" data-testid="tour-share">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sharePicture}
          disabled={drawing}
          aria-describedby={words}
          className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-60"
        >
          Share your tour
        </button>
        <button
          type="button"
          onClick={shareText}
          className="rounded-full border border-chalk/30 px-5 py-2.5 font-semibold transition hover:border-chalk"
        >
          Share as text
        </button>
        <span id={words} hidden>
          {tourShareSummary({ cleared: clearedCount(route, record), total: route.length })}
        </span>
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-chalk-dim">
        {note}
      </p>
    </div>
  );
}
