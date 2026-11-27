/**
 * Whether this browser will start a silent video by itself. Some phones won't (an iPhone in Low
 * Power Mode, for one): the video then sits on its first frame, or never loads at all. So pages
 * ask first, and show an animated image to anyone whose phone says no.
 *
 * Asked once per page, with the half-second, 64-pixel silent clip below (nothing to download).
 * It's played from a blob: URL, which the site's security policy allows for media (data: isn't).
 */
const PROBE = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAfQAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAfQAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAH0AAAAAAABAAAAAAHabWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAFABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAe/+EAF2dCwB7ZBCbARAAAAwAEAAADAFA8WLkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAArMAAAKzAAAAAYc3R0cwAAAAAAAAABAAAABQAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAosAAAAKAAAACgAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA2gAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACu21kYXQAAAJtBgX//2ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD01IGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTUgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFmWIhA/yYoAAw+ycnJ1111111111114AAAAGQZo4H+EYAAAABkGaVAf4RgAAAAZBmmA7wjAAAAAGQZqAN8Iw";

let verdict: Promise<boolean> | null = null;

export function canAutoplay(timeoutMs = 2000): Promise<boolean> {
  if (verdict) return verdict;
  verdict = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") return resolve(false);
    const video = document.createElement("video");
    let settled = false;
    let url: string | undefined;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
        if (url) URL.revokeObjectURL(url);
      } catch {
        /* nothing to tidy */
      }
    };
    // No answer at all counts as no: the animated image always works.
    const timer = setTimeout(() => settle(false), timeoutMs);
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    try {
      const bytes = Uint8Array.from(atob(PROBE), (c) => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    } catch {
      return settle(false);
    }
    video.src = url;
    try {
      const started = video.play();
      if (started && typeof started.then === "function") {
        // Said yes and actually going.
        started.then(() => settle(!video.paused), () => settle(false));
      } else {
        video.addEventListener("playing", () => settle(true), { once: true });
        video.addEventListener("error", () => settle(false), { once: true });
      }
    } catch {
      settle(false);
    }
  });
  return verdict;
}

/** For tests: forget the answer so the next call asks again. */
export function resetAutoplayVerdict() {
  verdict = null;
}

/**
 * Runs `fn` once the page's own content (the flyer and everything above the fold) has loaded, or
 * after `maxWaitMs` if that takes longer, so a background download never slows the first view.
 * Returns a function that cancels it.
 */
export function afterPageLoad(fn: () => void, maxWaitMs = 4000): () => void {
  let done = false;
  let settle: number | undefined;
  const run = () => {
    if (done) return;
    done = true;
    cleanup();
    fn();
  };
  const onLoad = () => {
    settle = window.setTimeout(run, 150);
  };
  const cap = window.setTimeout(run, maxWaitMs);
  function cleanup() {
    window.removeEventListener("load", onLoad);
    clearTimeout(cap);
    if (settle !== undefined) clearTimeout(settle);
  }
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad);
  return () => {
    done = true;
    cleanup();
  };
}
