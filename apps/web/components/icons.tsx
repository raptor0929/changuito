/**
 * The shopper's inline icons.
 *
 * Conventions come from apps/landing/components/landing/icons.tsx so the two
 * apps draw one family: currentColor stroke, width 2, round cap and join, no
 * fill, aria-hidden. The 24-unit box at 16px matches that file's social icons
 * rather than its 32px feature icons — this one sits inline with 12px button
 * text, not in a card. Instagram matches the landing stroke glyph. X is
 * filled so it does not read as a close icon. The shopper footer does not
 * draw these; the landing footer does.
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

/** Same 24-unit social box as the landing footer glyphs. */
function socialGlyph(className: string | undefined, size: number) {
  return {
    className,
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
}

/** Camera mark. Path matches apps/landing/components/landing/icons.tsx. */
export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 18)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * X mark. Filled, and slightly smaller than the stroked camera, so the
 * weight matches the other social glyphs and it does not read as a close
 * icon. aria-hidden when a link draws it next to a visible name.
 */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 16)} fill="currentColor" stroke="none">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

/**
 * LinkedIn mark. Filled, like X, and the same 16px box: a stroked "in"
 * next to the stroked camera reads as a third weight. The path is the
 * company logo, painted with currentColor so it follows the footer grey.
 */
export function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 16)} fill="currentColor" stroke="none">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

/**
 * Globe, for the language switch. Same social box, because it sits in the
 * footer row beside those two and a different weight would read as a
 * different kind of control. Meridian and equator only: a globe with
 * coastlines at 18px is a smudge, and the coastlines of *which* continent is
 * a question a language switch should not be answering.
 */
/** Mic, for the composer's voice search. 22px in a 44px hit target. */
export function MicIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 22)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  );
}

/** Picture, for attaching a list or a product already on the phone. */
export function ImageIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 22)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M3 16l5-4 4 3 3-2 6 5" />
    </svg>
  );
}

/** Camera, for taking the photo in the aisle. Not the Instagram mark. */
export function CameraIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 22)}>
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 16)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </svg>
  );
}
