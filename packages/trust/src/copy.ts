/**
 * Footer trust copy shared by the landing and the shopper.
 *
 * The year, the registered mark, and the founder names are written once.
 * Pages render `FounderTrust` from `@changuito/trust/ui` and do not repeat
 * a second copyright line beside it.
 */

export const COPYRIGHT_YEAR = 2026;

/** Registered trademark, U+00AE. Not the letters "(R)". */
export const BRAND_MARK = 'Changuito\u00AE';

export const COPYRIGHT_LINE = `\u00A9 ${COPYRIGHT_YEAR} ${BRAND_MARK}`;

/**
 * Personal attribution for an early product. Not a registered company
 * and not a job title. Link text is the visible label.
 */
export const FOUNDERS = [
  { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
  { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
] as const;

export const FOUNDER_PREFIX = 'Hecho en 🇦🇷 por ';
export const FOUNDER_JOIN = ' y ';
export const FOUNDER_END = '.';

export const FOUNDER_SENTENCE = `${FOUNDER_PREFIX}${FOUNDERS[0].name}${FOUNDER_JOIN}${FOUNDERS[1].name}${FOUNDER_END}`;

/** Middle dot, U+00B7. Not an em dash and not an en dash. */
export const TRUST_SEPARATOR = ' \u00B7 ';

/** One line when the footer is wide enough to hold it. */
export const TRUST_LINE = `${COPYRIGHT_LINE}${TRUST_SEPARATOR}${FOUNDER_SENTENCE}`;

/** Spoken after each name. The visible label stays the name itself. */
export const NEW_TAB_HINT = 'se abre en una pestaña nueva';
