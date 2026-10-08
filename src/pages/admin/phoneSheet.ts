/**
 * Admin dialogs on phones: fill the screen like an app's pushed screen instead
 * of a small box floating over the page, slide up from the bottom, and keep
 * clear of the notch and home indicator. No effect from the `sm` breakpoint up.
 */
export const PHONE_SHEET = [
  "max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0",
  "max-sm:w-full max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0",
  "max-sm:p-4 max-sm:pt-[calc(env(safe-area-inset-top)+18px)] max-sm:pb-[calc(env(safe-area-inset-bottom)+16px)]",
  "max-sm:overscroll-contain max-sm:content-start",
  "max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-0 max-sm:data-[state=open]:slide-in-from-bottom-10 max-sm:data-[state=open]:zoom-in-100",
  "max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-0 max-sm:data-[state=closed]:slide-out-to-bottom-10 max-sm:data-[state=closed]:zoom-out-100",
  // the close (×) button: below the status bar, with a finger-sized target
  "max-sm:[&>button:last-child]:top-[calc(env(safe-area-inset-top)+10px)] max-sm:[&>button:last-child]:right-2 max-sm:[&>button:last-child]:p-2.5",
].join(" ");

/**
 * Dialogs normally focus their first field on open, which on a phone throws
 * the keyboard up over the form before you've seen it. On touch screens focus
 * the dialog itself instead; with a mouse, keep the usual behaviour.
 */
export function keepKeyboardClosed(e: Event) {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
}
