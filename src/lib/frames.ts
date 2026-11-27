/**
 * A clip as a run of still frames, drawn by the clock rather than by the browser.
 *
 * Phones that won't play video by themselves (iPhone Low Power Mode, some in-app browsers) will
 * still animate an image, but an animated image that can't be drawn fast enough plays in slow
 * motion: every frame is shown, just late. Drawing stills ourselves, we pick the frame for the
 * moment it is now, so the clip always runs at its true speed; a slow phone just skips frames.
 */

/** Splits back-to-back RIFF files (WebP stills, one per frame) into one Blob per frame. */
export function splitFrames(buf: ArrayBuffer, type = "image/webp"): Blob[] {
  const view = new DataView(buf);
  const frames: Blob[] = [];
  let at = 0;
  while (at + 12 <= buf.byteLength && view.getUint32(at) === 0x52494646 /* "RIFF" */) {
    const size = view.getUint32(at + 4, true) + 8;
    if (at + size > buf.byteLength) break;
    frames.push(new Blob([new Uint8Array(buf, at, size)], { type }));
    at += size + (size & 1);
  }
  return frames;
}

/** The frame to show `elapsedMs` into a looping clip of `count` frames at `fps`. */
export function frameAt(elapsedMs: number, fps: number, count: number): number {
  if (count <= 0) return 0;
  const n = Math.floor((Math.max(0, elapsedMs) / 1000) * fps);
  return n % count;
}

export interface DecodedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Decodes one still, off the main thread where the browser can. */
export async function decodeFrame(blob: Blob): Promise<DecodedFrame> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}
