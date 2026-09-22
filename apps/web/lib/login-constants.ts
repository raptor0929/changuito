/** Easy to change. Guests may send this many chat turns without logging in. */
export const FREE_TURNS = 3;

/** Softer IP ceiling: blocks sessionId-rotation abuse without locking a café. */
export const FREE_TURNS_PER_IP = FREE_TURNS * 10;

export const USER_COOKIE = 'chg_user';
export const LOGIN_REQUIRED = 'login_required' as const;

export const LOGIN_REQUIRED_MESSAGE =
  'Para seguir, iniciá sesión. Así podemos anotarte y seguir mejorando Changuito.';

/** Primary CTA on the anonymous gate. The signed-in wallet does not use this. */
export const LOGIN_CTA = 'Empezá a comprar';

export interface LoginGateInput {
  isAuthenticated: boolean;
  /** Server answered `login_required`, or the client latched that lock. */
  loginRequired: boolean;
  /**
   * Guest turns already consumed. Omitted when the caller only has the latch.
   * Signed-in shoppers ignore the count entirely.
   */
  turnsUsed?: number;
  freeTurns?: number;
}

/**
 * The soft-limit banner and its CTA are a guest gate.
 * A signed-in shopper never sees them, even after the free turns are spent.
 */
export function shouldShowLoginGate(args: LoginGateInput): boolean {
  if (args.isAuthenticated) return false;
  if (args.loginRequired) return true;
  if (typeof args.turnsUsed !== 'number') return false;
  const free = args.freeTurns ?? FREE_TURNS;
  return args.turnsUsed >= free;
}

/** Banner body, or null when the gate must stay off the screen. */
export function loginGateBannerText(args: LoginGateInput): string | null {
  if (!shouldShowLoginGate(args)) return null;
  return LOGIN_REQUIRED_MESSAGE;
}
