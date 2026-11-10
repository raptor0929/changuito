/**
 * Whose chats are in this browser, and wiping them when that changes.
 *
 * chat-store.ts keeps chats in localStorage — the transcript, the cart, the
 * postcode in the session snapshot, the receipt of what was paid — under keys
 * that belong to no one in particular. So signing out and in as another Privy
 * account showed the previous account's history, purchases and postcode.
 *
 * Now the browser records which wallet the stored chats belong to
 * (`changuito:owner`) and everything under `changuito:` is wiped, in
 * localStorage and sessionStorage, when:
 *   - a different wallet signs in than the one on record, or
 *   - the shopper signs out (WalletWidget calls `wipeLocalAccount`), or
 *   - the session ends elsewhere and the page finds nobody signed in while a
 *     wallet is on record.
 * A guest's chats have no owner and are adopted by whoever signs in next: a
 * basket started as a guest and paid after signing in is one conversation.
 *
 * Privy's own storage is Privy's: its logout clears it. Nothing here touches
 * another origin's data or the language cookie.
 *
 * Every access is wrapped, as in chat-store.ts: Safari in private mode throws.
 * No imports, so it loads under `node --experimental-strip-types`.
 */

export const OWNER_KEY = 'changuito:owner';
const PREFIX = 'changuito:';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function stores(): Store[] {
  const out: Store[] = [];
  for (const get of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      out.push(get());
    } catch {
      /* unavailable: nothing to wipe there */
    }
  }
  return out;
}

/** Remove every `changuito:` key from the given stores (default: this browser's). */
export function wipeLocalAccount(targets: Store[] = typeof window === 'undefined' ? [] : stores()): void {
  for (const s of targets) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
      for (const k of keys) s.removeItem(k);
    } catch {
      /* best effort */
    }
  }
}

export function readOwner(s: Store | undefined = typeof window === 'undefined' ? undefined : stores()[0]): string | null {
  try {
    return s?.getItem(OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeOwner(address: string, s: Store | undefined = typeof window === 'undefined' ? undefined : stores()[0]): void {
  try {
    s?.setItem(OWNER_KEY, address);
  } catch {
    /* best effort */
  }
}

/**
 * What to do with this browser's stored chats, given who owns them and who is
 * signed in now. Pure, for tests.
 *   - `wait`: Privy has not said yet, or the wallet is still being created.
 *   - `keep`: same account, or a guest with a guest's chats.
 *   - `adopt`: a guest's chats, and now someone signed in: record them as owner.
 *   - `wipe`: the chats are another account's, or that account signed out.
 */
export function accountDecision(i: {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  owner: string | null;
}): 'wait' | 'keep' | 'adopt' | 'wipe' {
  if (!i.ready) return 'wait';
  if (i.authenticated && !i.address) return 'wait';
  if (!i.owner) return i.address ? 'adopt' : 'keep';
  return i.owner === i.address ? 'keep' : 'wipe';
}
