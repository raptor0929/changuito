/**
 * Public profiles for the shopper footer.
 *
 * Same accounts as `SOCIAL` in `apps/landing/lib/copy.ts`. Copied here so
 * the shopper can ship without importing the landing app. Href and
 * accessible name stay in lockstep with that list.
 */

export const SOCIAL = [
  {
    id: 'instagram',
    href: 'https://instagram.com/appchanguito',
    ariaLabel: 'Changuito en Instagram',
  },
  {
    id: 'x',
    href: 'https://x.com/appchanguito',
    ariaLabel: 'Changuito en X',
  },
] as const;

export type SocialId = (typeof SOCIAL)[number]['id'];
