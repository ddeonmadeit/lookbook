import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPageLoad } from "@/lib/pageLoad";

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
