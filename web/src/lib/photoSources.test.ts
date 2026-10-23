import { describe, expect, it } from "vitest";

import {
  originalUrl,
  PLACEHOLDER_WIDTH,
  placeholderUrl,
  sources,
  thumbUrl,
  WIDTHS,
} from "./photoSources";

const name = "A%2C_b.jpg";
const thumb = (host: string) =>
  `https://${host}/wikipedia/commons/thumb/a/ab/${name}/1280px-${name}`;
const orig = `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`;
const at = (host: string, w: number) =>
  `https://${host}/wikipedia/commons/thumb/a/ab/${name}/${w}px-${name}`;

describe("photoSources", () => {
  it("lists the standard widths", () => {
    expect(WIDTHS).toEqual([1280, 1920, 3840]);
  });

  it("blurs a tiny thumbnail of the same photo while it loads", () => {
    expect(PLACEHOLDER_WIDTH).toBe(60);
    for (const host of ["thumb.wikimedia.org", "upload.wikimedia.org"]) {
      expect(placeholderUrl(thumb(host))).toBe(at(host, 60));
    }
    expect(placeholderUrl("https://example.com/x.jpg")).toBeNull();
  });

  it("rewrites the width segment for both hosts", () => {
    for (const host of ["thumb.wikimedia.org", "upload.wikimedia.org"]) {
      expect(thumbUrl(thumb(host), 3840)).toBe(at(host, 3840));
    }
  });

  it("derives the original from either thumb host", () => {
    expect(originalUrl(thumb("thumb.wikimedia.org"))).toBe(orig);
    expect(originalUrl(thumb("upload.wikimedia.org"))).toBe(orig);
    expect(originalUrl("https://example.com/x.jpg")).toBeNull();
  });

  it("uses only the 1280 entry when the width is unknown", () => {
    const u = thumb("thumb.wikimedia.org");
    expect(sources({ imageUrl: u })).toEqual({ src: u, srcSet: `${u} 1280w`, full: u });
  });

  it("offers 1280 plus the original for a 1500px file", () => {
    const u = thumb("thumb.wikimedia.org");
    const s = sources({ imageUrl: u, width: 1500 });
    expect(s.src).toBe(u);
    expect(s.srcSet).toBe(`${u} 1280w, ${orig} 1500w`);
    expect(s.full).toBe(orig);
  });

  it("offers every width below a 5000px file plus the original", () => {
    const h = "thumb.wikimedia.org";
    const s = sources({ imageUrl: thumb(h), width: 5000 });
    expect(s.srcSet).toBe(
      [1280, 1920, 3840].map((w) => `${at(h, w)} ${w}w`).join(", ") + `, ${orig} 5000w`,
    );
    expect(s.full).toBe(orig);
  });

  it("never upscales a file smaller than 1280px", () => {
    const u = thumb("thumb.wikimedia.org");
    expect(sources({ imageUrl: u, width: 1000 }).srcSet).toBe(`${u} 1280w`);
  });

  it("passes non-thumb URLs through unchanged", () => {
    const u = "https://example.com/photo.jpg";
    expect(thumbUrl(u, 1920)).toBe(u);
    expect(sources({ imageUrl: u, width: 5000 })).toEqual({ src: u, srcSet: u, full: u });
  });
});
