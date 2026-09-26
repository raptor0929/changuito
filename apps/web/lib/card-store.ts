import { type NetworkId, NETWORK_IDS } from './deployments.ts';

/**
 * A hint, in localStorage, that this browser has seen a card before.
 *
 * ## What this is not
 *
 * It is not the card, and it is not evidence of anything. No PAN, no CVV, no
 * expiry — CardPanel's header says those live in React state for the length of
 * the dialog and nowhere else, and that sentence stays true because this file
 * cannot write them. `pack` builds the record field by field from a fixed
 * list, the same discipline chat-store.ts uses and for the same reason: a
 * guardrail that has to be remembered is not a guardrail.
 *
 * It is also not authority. The server decides which card a customer has, by
 * reading `card_owner` against the wallet the deposit proved. Clearing this
 * key must change nothing except the sentence on screen — that is exactly the
 * by-hand check the plan calls the one that actually proves "exactly one
 * card", because this mirror is the thing that could otherwise fake it.
 *
 * ## What it is for
 *
 * One sentence, shown before any round trip: "you already have one of ours,
 * ending 4242, and this deposit tops it up". Without it a returning customer
 * sees "Generar una tarjeta" and reasonably concludes they are about to be
 * given a second card — which is the one thing the product promises not to do.
 *
 * ## The key
 *
 * `changuito:card:v1:<net>`, per network, because a card funded with play
 * money must never be mistaken for the one real deposits top up. The `v1` is
 * so a shape change can be ignored rather than migrated.
 *
 * The plan wrote this key as `chg:card:v1:<net>`. `chg:` is this app's *Redis*
 * prefix (`chg:demo-pay:*`, and the `chg:card:*` latch that became a Postgres
 * column); every localStorage key it has ever written is `changuito:`. Two
 * prefixes for two stores is the convention worth keeping.
 */

const PREFIX = 'changuito:card:v1:';

export interface CardHint {
  cardId: string;
  /** The only digits here, and the only ones a person needs to recognise it. */
  last4: string;
  /** visa / mastercard — the logo, so the sentence can carry it. */
  brand: string;
  network: NetworkId;
  issuedAt: number;
}

const key = (net: NetworkId) => `${PREFIX}${net}`;

/**
 * Every access is wrapped, because Safari in private mode throws on
 * `localStorage` rather than returning null — NetworkProvider and chat-store
 * both learned that the same way.
 */
function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Field by field. Nothing reaches storage that is not named right here. */
function pack(h: CardHint): string {
  return JSON.stringify({
    cardId: h.cardId,
    last4: h.last4,
    brand: h.brand,
    network: h.network,
    issuedAt: h.issuedAt,
  });
}

/**
 * Re-validated on the way back in, because stored JSON was written by the
 * user's own browser and can be edited by hand. A record that does not
 * survive this is dropped rather than repaired: the server is about to answer
 * the same question properly anyway.
 */
export function readHint(raw: string | null, net: NetworkId): CardHint | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  const cardId = typeof o.cardId === 'string' ? o.cardId.trim() : '';
  const last4 = typeof o.last4 === 'string' ? o.last4.trim() : '';
  const brand = typeof o.brand === 'string' ? o.brand.trim() : '';
  const issuedAt = typeof o.issuedAt === 'number' && Number.isFinite(o.issuedAt) ? o.issuedAt : 0;

  if (!cardId) return null;
  // Four digits, and only four. A longer run under this name would be a PAN
  // somebody wrote here by hand, and echoing it into the DOM is not a thing
  // this app is going to do on the strength of a localStorage key.
  if (!/^\d{4}$/.test(last4)) return null;
  // The network is read from the key, not from the record: a record that
  // claims another network is a record in the wrong place.
  if (o.network !== net || !NETWORK_IDS.includes(net)) return null;

  return { cardId, last4, brand: brand.slice(0, 24), network: net, issuedAt };
}

/** The card this browser last saw on this network, if it saw one. */
export function recallCard(net: NetworkId): CardHint | null {
  const s = store();
  if (!s) return null;
  try {
    return readHint(s.getItem(key(net)), net);
  } catch {
    return null;
  }
}

export function rememberCard(net: NetworkId, card: { cardId: string; last4: string; brand: string }): void {
  const s = store();
  if (!s) return;
  const hint = readHint(
    pack({ ...card, network: net, issuedAt: Date.now() }),
    net,
  );
  // Validated on the way out as well as on the way in, so a caller that hands
  // this a PAN in the `last4` slot writes nothing at all.
  if (!hint) return;
  try {
    s.setItem(key(net), pack(hint));
  } catch {
    /* full, or private mode. The sentence is a nicety; the card is not. */
  }
}

/** Called when the card is gone for good, so the next one is offered plainly. */
export function forgetCard(net: NetworkId): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key(net));
  } catch {
    /* nothing to do, and nothing depends on it */
  }
}
