import { describe, expect, it } from "vitest";
import { frameAt, splitFrames } from "@/lib/frames";

const bytesOf = (blob: Blob) =>
  new Promise<number[]>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** A fake WebP still: "RIFF", little-endian size, "WEBP", then `body` bytes. */
function riff(body: number[]): number[] {
  const payload = [0x57, 0x45, 0x42, 0x50, ...body]; // "WEBP" + body
  const n = payload.length;
  return [0x52, 0x49, 0x46, 0x46, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255, ...payload];
}

describe("the clip's frames", () => {
  it("come apart into one still per frame, in order", async () => {
    const a = riff([1, 2, 3, 4]);
    const b = riff([5, 6]);
    const frames = splitFrames(new Uint8Array([...a, ...b]).buffer);
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.size)).toEqual([a.length, b.length]);
    expect(frames[0].type).toBe("image/webp");
    expect(await bytesOf(frames[1])).toEqual(b);
  });
  it("skip the pad byte after an odd-sized still", () => {
    const odd = riff([1, 2, 3]); // 15 bytes: padded to 16
    const next = riff([9, 9]);
    const frames = splitFrames(new Uint8Array([...odd, 0, ...next]).buffer);
    expect(frames.map((f) => f.size)).toEqual([odd.length, next.length]);
  });
  it("stop at anything that isn't a still, or one cut short", () => {
    expect(splitFrames(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer)).toHaveLength(0);
    const whole = riff([1, 2, 3, 4]);
    const cut = riff([1, 2, 3, 4, 5, 6]).slice(0, 10);
    expect(splitFrames(new Uint8Array([...whole, ...cut]).buffer)).toHaveLength(1);
  });
});

describe("which frame to show", () => {
  it("follows the clock, at 30 a second", () => {
    expect(frameAt(0, 30, 271)).toBe(0);
    expect(frameAt(1000, 30, 271)).toBe(30);
    expect(frameAt(2500, 30, 271)).toBe(75);
  });
  it("loops round", () => {
    expect(frameAt(9100, 30, 271)).toBe(2); // 273 frames in: two into the second loop
  });
  it("skips frames on a slow phone rather than slowing down", () => {
    // However long since the last frame was drawn, it's the frame for now.
    expect(frameAt(1000, 30, 271) - frameAt(500, 30, 271)).toBe(15);
  });
  it("copes with nothing to show", () => {
    expect(frameAt(1000, 30, 0)).toBe(0);
    expect(frameAt(-50, 30, 271)).toBe(0);
  });
});
