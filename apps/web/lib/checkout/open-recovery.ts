import { readOrder, type OrderAccount } from './escrow-server.ts';
import { checkoutStore, type CheckoutRecord } from './store.ts';

/** A broadcast intent becomes funded only after matching the actual on-chain order. */
export async function recoverOpenAttempt(rec: CheckoutRecord, deps: {
  read: (id: string) => Promise<OrderAccount | null>;
  save: (rec: CheckoutRecord) => Promise<void>;
} = { read: readOrder, save: value => checkoutStore().set(value) }): Promise<CheckoutRecord> {
  if (rec.openSig || !rec.openAttemptSig) return rec;
  const order = await deps.read(rec.orderId);
  if (!order || order.orderId !== rec.orderId || order.buyer !== rec.buyer
      || order.amount !== BigInt(rec.amount) || order.basketHash !== rec.basketHash) return rec;
  rec.openSig = rec.openAttemptSig;
  await deps.save(rec);
  return rec;
}
