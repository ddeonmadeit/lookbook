import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPageLoad, canAutoplay, resetAutoplayVerdict } from "@/lib/autoplay";

const proto = HTMLMediaElement.prototype;
const realPlay = proto.play;
const realPaused = Object.getOwnPropertyDescriptor(proto, "paused");

/** Pretend the browser answers play() like `answer`, and says the video is (not) moving. */
function browserSays(answer: () => Promise<void> | undefined, moving = true) {
  proto.play = vi.fn(answer) as typeof proto.play;
  Object.defineProperty(proto, "paused", { configurable: true, get: () => !moving });
}

describe("asking whether video will play by itself", () => {
  beforeEach(() => {
    resetAutoplayVerdict();
    URL.createObjectURL = vi.fn(() => "blob:probe");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(proto, "load").mockImplementation(() => {});
    vi.spyOn(proto, "pause").mockImplementation(() => {});
  });
  afterEach(() => {
    proto.play = realPlay;
    if (realPaused) Object.defineProperty(proto, "paused", realPaused);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is yes when the test clip starts moving", async () => {
    browserSays(() => Promise.resolve());
    await expect(canAutoplay()).resolves.toBe(true);
  });
  it("is no when the phone refuses (Low Power Mode)", async () => {
    browserSays(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    await expect(canAutoplay()).resolves.toBe(false);
  });
  it("is no when the phone says yes but doesn't actually move it", async () => {
    browserSays(() => Promise.resolve(), false);
    await expect(canAutoplay()).resolves.toBe(false);
  });
  it("is no when the phone never answers", async () => {
    vi.useFakeTimers();
    browserSays(() => new Promise<void>(() => {}));
    const verdict = canAutoplay(2000);
    vi.advanceTimersByTime(2000);
    await expect(verdict).resolves.toBe(false);
  });
  it("is no when the test clip can't even be made", async () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error("unsupported");
    });
    browserSays(() => Promise.resolve());
    await expect(canAutoplay()).resolves.toBe(false);
  });
  it("plays the test clip from memory and tidies it away", async () => {
    browserSays(() => Promise.resolve());
    await canAutoplay();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "video/mp4" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:probe");
  });
  it("asks once per page", async () => {
    browserSays(() => Promise.resolve());
    await canAutoplay();
    await canAutoplay();
    expect(proto.play).toHaveBeenCalledTimes(1);
  });
});

describe("waiting for the page to load", () => {
  let state: DocumentReadyState = "loading";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "readyState", "get").mockImplementation(() => state);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts just after the page finishes loading", () => {
    state = "loading";
    const fn = vi.fn();
    afterPageLoad(fn, 4000);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("starts straight away on a page that has already loaded", () => {
    state = "complete";
    const fn = vi.fn();
    afterPageLoad(fn);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("doesn't wait forever on a page that's slow to load", () => {
    state = "loading";
    const fn = vi.fn();
    afterPageLoad(fn, 4000);
    vi.advanceTimersByTime(4000);
    expect(fn).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("can be called off", () => {
    state = "loading";
    const fn = vi.fn();
    const cancel = afterPageLoad(fn, 4000);
    cancel();
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
