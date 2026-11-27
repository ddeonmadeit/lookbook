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
