/** Wikimedia's standard thumbnail widths. */
export const WIDTHS = [1280, 1920, 3840] as const;

const THUMB_SEGMENT = /\/(\d+)px-([^/]*)$/;
const THUMB_PATH = /^https:\/\/[^/]+\/wikipedia\/commons\/thumb\/([^/]+\/[^/]+\/[^/]+)\/\d+px-[^/]*$/;

/** Rewrites the "/<n>px-" segment of a thumbnail URL; other URLs pass through unchanged. */
export function thumbUrl(imageUrl: string, w: number): string {
  return imageUrl.replace(THUMB_SEGMENT, `/${w}px-$2`);
}

/** The full-size original of a Wikimedia thumbnail URL (null if it is not one). */
export function originalUrl(imageUrl: string): string | null {
  const m = THUMB_PATH.exec(imageUrl);
  return m ? `https://upload.wikimedia.org/wikipedia/commons/${m[1]}` : null;
}

/**
 * Width of the tiny thumbnail shown blurred while the real photo loads: one of Wikimedia's
 * standard small sizes, a couple of kilobytes, so it usually arrives long before the photo.
 */
export const PLACEHOLDER_WIDTH = 60;

/**
 * The blurred stand-in for a photo: its 60px Wikimedia thumbnail, or null for photos that are
 * not Wikimedia thumbnails (they have no cheap small version, so the frame stays a plain blur).
 */
export function placeholderUrl(imageUrl: string): string | null {
  return THUMB_SEGMENT.test(imageUrl) ? thumbUrl(imageUrl, PLACEHOLDER_WIDTH) : null;
}

export interface PhotoSources {
  src: string;
  srcSet: string;
  /** Largest candidate, used once the player zooms in. */
  full: string;
}

export function sources(photo: { imageUrl: string; width?: number }): PhotoSources {
  const { imageUrl, width } = photo;
  const src = thumbUrl(imageUrl, WIDTHS[0]);
  if (!THUMB_SEGMENT.test(imageUrl)) return { src: imageUrl, srcSet: imageUrl, full: imageUrl };

  const entries: { url: string; w: number }[] = [{ url: src, w: WIDTHS[0] }];
  if (width && width > 0) {
    for (const w of WIDTHS.slice(1)) {
      if (w < width) entries.push({ url: thumbUrl(imageUrl, w), w });
    }
    const original = originalUrl(imageUrl);
    if (original && width > WIDTHS[0]) entries.push({ url: original, w: width });
  }
  return {
    src,
    srcSet: entries.map((e) => `${e.url} ${e.w}w`).join(", "),
    full: entries[entries.length - 1].url,
  };
}
