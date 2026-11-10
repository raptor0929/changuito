/**
 * Delete the shopper's Changuito data for the wallet in the session cookie.
 *
 * What goes:
 *   - the encrypted Día profile (email, password, DNI, postal code)
 *   - archived chats, and the order rows that hang off them
 *   - order rows stored under this address even if the chat id differs
 *   - checkout records in `kv` (`checkout:<orderId>`, buyer on the document)
 *   - the working turn of each archived chat (`changuito:turn:<sessionId>`)
 *   - the hourly usage counter (`changuito:user-turns:<address>`)
 *   - a legacy card-owner row, if one still names this address
 *
 * What does not go, and the profile screen says so: the shopper's account at
 * Día, and anything already written on the public network. A turn that was still only in
 * `kv` and not yet archived expires on its own within the hour; its key is the
 * session id, which this table does not index by wallet.
 *
 * The counter key is the same string login-gate.ts builds. It is copied here
 * rather than exported from that module, which is shared with the other chain
 * repo. lib/test/account-delete.test.ts reads both files so they cannot drift.
 */
import { db, hasDatabase } from './db.ts';
import type { CheckoutRecord } from './checkout/store.ts';
import { DELETE_CONFIRM } from './delete-confirm.ts';
import { aadFor } from './profile-crypto.ts';

export { DELETE_CONFIRM };

/** Must match `KEY_USER` in lib/login-gate.ts. */
export const USER_TURNS_KEY = (address: string) => `changuito:user-turns:${address}`;

/** Must match `KEY` in lib/agent/turn-store.ts. */
export const TURN_KEY = (sessionId: string) => `changuito:turn:${sessionId}`;

export interface DeletedAccount {
  profile: number;
  chats: number;
  orders: number;
  checkouts: number;
  turns: number;
  quota: number;
  /** False when there is no database and only this process's memory was cleared. */
  durable: boolean;
}

const profiles = () => (globalThis as { __chgProfiles?: Map<string, unknown> }).__chgProfiles;
const checkouts = () => (globalThis as { __chgCheckouts?: Map<string, CheckoutRecord> }).__chgCheckouts;

function forgetProfileMemory(address: string): number {
  const map = profiles();
  if (!map) return 0;
  let n = 0;
  for (const key of [...map.keys()]) {
    // aadFor is `${network}|${address}`. Match the suffix so every network goes.
    if (key === address || key.endsWith(`|${address}`)) {
      map.delete(key);
      n += 1;
    }
  }
  return n;
}

function forgetCheckoutMemory(address: string): number {
  const map = checkouts();
  if (!map) return 0;
  let n = 0;
  for (const [key, rec] of [...map.entries()]) {
    if (rec?.buyer === address) {
      map.delete(key);
      n += 1;
    }
  }
  return n;
}

/** Touch the profile map the same way a save does, so a delete sees it. */
export function profileMemoryKey(network: string, address: string): string {
  return aadFor(network, address);
}

export async function deleteAccountData(address: string): Promise<DeletedAccount> {
  const memoryProfiles = forgetProfileMemory(address);
  const memoryCheckouts = forgetCheckoutMemory(address);
  if (!hasDatabase()) {
    return {
      profile: memoryProfiles,
      chats: 0,
      orders: 0,
      checkouts: memoryCheckouts,
      turns: 0,
      quota: 0,
      durable: false,
    };
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const orders = await tx`delete from orders where address = ${address} returning chat_id`;
    const chats = await tx`delete from chat where address = ${address} returning id`;
    const profile = await tx`delete from profile where address = ${address} returning address`;
    await tx`delete from card_owner where address = ${address}`;
    const quota = await tx`delete from quota where key = ${USER_TURNS_KEY(address)} returning key`;
    const checkoutRows = await tx`
      delete from kv
       where key like 'checkout:%'
         and value->>'buyer' = ${address}
      returning key`;
    let turns = 0;
    for (const row of chats) {
      const id = row.id as string;
      const gone = await tx`delete from kv where key = ${TURN_KEY(id)} returning key`;
      turns += gone.length;
    }
    return {
      profile: profile.length,
      chats: chats.length,
      orders: orders.length,
      checkouts: checkoutRows.length,
      turns,
      quota: quota.length,
      durable: true,
    };
  });
}
