/** A coat hanger: shows a product's sizes. Line icon, matching lucide's (2px stroke, currentColor). */
export const HangerIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 10V8.4a2.6 2.6 0 1 0-2.6-2.6" />
    <path d="M12 10 3.4 16.3a1.4 1.4 0 0 0 .8 2.5h15.6a1.4 1.4 0 0 0 .8-2.5L12 10z" />
  </svg>
);

/** A solid purse with a top handle: the bag. Filled with currentColor. */
export const PurseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      d="M8.3 10.5V7.8a3.7 3.7 0 0 1 7.4 0v2.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
    <path
      d="M6.4 9.6h11.2a1.6 1.6 0 0 1 1.57 1.3l1.7 8.6a2 2 0 0 1-1.96 2.4H5.09a2 2 0 0 1-1.96-2.4l1.7-8.6A1.6 1.6 0 0 1 6.4 9.6z"
      fill="currentColor"
    />
  </svg>
);
