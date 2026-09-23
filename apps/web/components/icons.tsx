/**
 * The shopper's inline icons.
 *
 * Conventions come from apps/landing/components/landing/icons.tsx so the two
 * apps draw one family: currentColor stroke, width 2, round cap and join, no
 * fill, aria-hidden. The 24-unit box at 16px matches that file's social icons
 * rather than its 32px feature icons — this one sits inline with 12px button
 * text, not in a card.
 */
export function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
