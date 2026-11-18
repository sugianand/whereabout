"use client";

import { useId, useState } from "react";

import type { Album } from "@/lib/album";
import {
  ALBUM_SHARE_NOTE,
  albumShareCard,
  albumShareSummary,
  albumShareText,
  sendAlbumShare,
} from "@/lib/albumShare";
import { sendShare, type ShareOutcome } from "@/lib/share";
import { useUnits } from "@/lib/useUnits";

const TEXT_NOTE: Record<ShareOutcome, string> = {
  shared: "Album shared.",
  copied: "Album copied. Paste it anywhere.",
  cancelled: "",
  failed: "Couldn't copy. Your browser blocked the clipboard.",
};

/**
 * Share your album: *Share your album* draws how full each continent's page is, with your
 * closest finds, and sends it with the counts and the link to play; *Share as text* sends the
 * counts alone. Neither ever names a photo or a place (`lib/albumShare.ts`).
 */
export default function AlbumShare({ album }: { album: Album }) {
  const units = useUnits();
  const [drawing, setDrawing] = useState(false);
  const [note, setNote] = useState("");
  const words = useId();
  const card = () => albumShareCard(album, window.location.href);

  async function sharePicture() {
    setDrawing(true);
    setNote(ALBUM_SHARE_NOTE.drawing);
    const outcome = await sendAlbumShare(card(), units);
    setDrawing(false);
    setNote(ALBUM_SHARE_NOTE[outcome]);
  }

  async function shareText() {
    setNote(TEXT_NOTE[await sendShare(albumShareText(card()), navigator)]);
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sharePicture}
          disabled={drawing}
          aria-describedby={words}
          className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-60"
        >
          Share your album
        </button>
        <button
          type="button"
          onClick={shareText}
          className="rounded-full border border-chalk/30 px-5 py-2.5 font-semibold transition hover:border-chalk"
        >
          Share as text
        </button>
        <span id={words} hidden>
          {albumShareSummary(album)}
        </span>
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-chalk-dim">
        {note}
      </p>
    </div>
  );
}
