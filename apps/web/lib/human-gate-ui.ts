/**
 * Client-safe human-gate decisions. No secrets and no `process.env`:
 * the browser bundle must not be the thing that decides production is "open".
 *
 * The shopper UI calls this with the JSON from GET /api/human. Only `open`
 * (local, keys unset) or a server-confirmed cookie (`enforce` + ok) unlocks
 * chat. Anything else stays on the verification screen.
 */

export const SOLO_HUMANOS = 'solo_humanos' as const;

/** Fired by the chat client when an API answers 403 solo_humanos. */
export const HUMAN_REQUIRED_EVENT = 'chg-human-required';

export type ClientGateDecision =
  | { action: 'unlock' }
  | { action: 'widget'; siteKey: string }
  | { action: 'block'; reason: 'closed' | 'unconfigured' };

export function clientGateDecision(input: {
  mode?: string;
  ok?: boolean;
  siteKey?: string;
}): ClientGateDecision {
  const siteKey = (input.siteKey ?? '').trim();
  if (input.mode === 'open') return { action: 'unlock' };
  if (input.mode === 'enforce' && input.ok === true) return { action: 'unlock' };
  // A public site key means we can draw Turnstile. `closed` used to skip the
  // widget entirely, which is the dead "reintentá en un rato" screen.
  if (siteKey) return { action: 'widget', siteKey };
  if (input.mode === 'enforce') return { action: 'block', reason: 'unconfigured' };
  return { action: 'block', reason: 'closed' };
}

export function notifyHumanRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HUMAN_REQUIRED_EVENT));
}
