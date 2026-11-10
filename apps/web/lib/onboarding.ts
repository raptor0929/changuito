import type { Lang } from './lang.ts';

/**
 * The first-visit explainer for beta testers: what this is, and the five
 * steps of a purchase. Shown once per browser, dismissed into localStorage.
 *
 * It is a modal, and the only way through it is the button. A click on the
 * dimmed page and Escape do nothing: the first visit has to read the five
 * steps. A later visit finds the key and the modal stays down, so the
 * production smokes set `changuito:onboarding:v1` before they click.
 */
export const ONBOARDING_KEY = 'changuito:onboarding:v1';

/**
 * Step 2 names the faucet, and "faucet" is a link when signed in: the text is
 * split around the linked word so the component never has to search a string.
 */
export interface FaucetStep {
  before: string;
  link: string;
  after: string;
}

export interface OnboardingCopy {
  title: string;
  steps: [string, FaucetStep, string, string, string];
  note: string;
  dismiss: string;
  /**
   * The phone version (<=560px): one short paragraph instead of the title,
   * steps and note, with the same "faucet" link, and a one-word button.
   * Both versions are in the DOM; CSS shows one (display:none also hides the
   * other from screen readers), so there is no hydration flash.
   */
  compact: FaucetStep;
  dismissShort: string;
}

/** Plain text of a step, for labels, keys and tests. */
export function stepText(step: string | FaucetStep): string {
  return typeof step === 'string' ? step : `${step.before}${step.link}${step.after}`;
}

const ES: OnboardingCopy = {
  title: 'Así funciona la beta',
  steps: [
    'Estamos en testnet.',
    { before: 'Iniciá sesión y cargá USDC gratis en el ', link: 'faucet', after: '.' },
    'Pedile a Changuito lo que necesitás.',
    'Pagás y tus USDC quedan en un escrow.',
    'Changuito compra en Día y libera el pago.',
  ],
  note: 'Si algo falla, tus USDC vuelven solos.',
  dismiss: 'Dale, empecemos',
  compact: { before: 'Beta en testnet: iniciá sesión, cargá USDC en el ', link: 'faucet', after: ' y pedile lo que necesitás.' },
  dismissShort: 'Dale',
};

const EN: OnboardingCopy = {
  title: 'How the beta works',
  steps: [
    "We're on testnet.",
    { before: 'Sign in and get free USDC from the ', link: 'faucet', after: '.' },
    'Ask Changuito for what you need.',
    'You pay and your USDC sits in an escrow.',
    'Changuito buys at Día and releases the payment.',
  ],
  note: 'If something fails, your USDC comes back on its own.',
  dismiss: "OK, let's go",
  compact: { before: 'Testnet beta: sign in, get free USDC from the ', link: 'faucet', after: ' and ask for what you need.' },
  dismissShort: 'OK',
};

export function onboardingCopy(lang: Lang): OnboardingCopy {
  return lang === 'en' ? EN : ES;
}

/** True when the explainer should show. Any storage error means "don't nag". */
export function shouldShowOnboarding(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return Boolean(storage) && storage!.getItem(ONBOARDING_KEY) === null;
  } catch {
    return false;
  }
}

export function dismissOnboarding(storage: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(ONBOARDING_KEY, String(Date.now()));
  } catch {
    // Private mode: it shows again next visit, which is harmless.
  }
}

/**
 * The onboarding's "faucet" word is a link only for a signed-in visitor: it
 * asks the top bar (WalletWidget.tsx) to open the same FaucetConfirm as the
 * "Cargar USDC" button, which itself only exists once there is a wallet.
 * Signed out, the word is plain text and starts nothing. A window event keeps
 * the two components unwired.
 */
export const OPEN_FAUCET_EVENT = 'changuito:open-faucet';

/** Signed in means the same as for the fund button: there is a wallet address. */
export function faucetLinkEnabled(wallet: { address: string | null }): boolean {
  return Boolean(wallet.address);
}

export function requestFaucet(target: Pick<EventTarget, 'dispatchEvent'> | null | undefined): void {
  target?.dispatchEvent(new CustomEvent(OPEN_FAUCET_EVENT));
}
