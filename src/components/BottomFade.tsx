/**
 * Phones only: the page fades softly into the background at the bottom of the screen, instead of
 * stopping in a hard line. (Pages scroll inside their own box, which ends where iOS Safari's
 * floating toolbar begins; below it Safari shows only the page background.)
 *
 * Goes last inside a page's scrolling box. It sticks to the bottom of the box while scrolling, and
 * takes up its own space at the very end, so the last of the page is never left faded.
 */
export const BottomFade = () => (
  <div
    aria-hidden="true"
    className="bottom-fade pointer-events-none sticky bottom-0 z-10 h-12 bg-gradient-to-t from-background via-background/60 to-background/0 md:hidden"
  />
);
