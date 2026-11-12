import { vi } from "vitest";

/**
 * A canvas that records the words drawn on it and a download link that records the files it
 * saves, so a test can press a picture button in jsdom (which has no canvas) and check what the
 * picture said and what it was saved as. `restore` puts the real ones back.
 */
export function stubCanvas() {
  const words: string[] = [];
  const saved: string[] = [];
  const ctx = {
    fillRect: () => {},
    beginPath: () => {},
    roundRect: () => {},
    arc: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: (t: string) => void words.push(t),
  };
  const spies = [
    vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D),
    vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done) => done(new Blob(["png"], { type: "image/png" }))),
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    }),
  ];
  URL.createObjectURL = () => "blob:picture";
  URL.revokeObjectURL = () => {};
  return { words, saved, restore: () => spies.forEach((s) => s.mockRestore()) };
}
