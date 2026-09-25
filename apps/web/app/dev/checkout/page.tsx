import { notFound } from 'next/navigation';

import { Fixture } from './Fixture';

/**
 * A supermarket checkout that is not a supermarket.
 *
 * There is no sandbox supermarket anywhere in this flow — Día has no test
 * store, and the deposit rail's test mode is real testnet Horizon while the
 * card's is a `sk_test_` key. Checkout is the one leg with no rehearsal of its
 * own, so this is it: a same-origin page the checkout modal frames in the
 * store's place in modo prueba, with the two buttons the real page has.
 *
 * It exists to exercise *our* side — the frame, the sandbox attributes, the
 * "ya lo pagué" hand-back, the receipt — and it proves nothing whatsoever
 * about Día. `e2e/app-frame-checkout.spec.ts` says the same thing in its
 * header, because a green test that looks like a purchase is worse than no
 * test at all.
 *
 * `notFound()` in production for the same reason app/dev/ui does: a page that
 * says "pagado" and takes no money has no business on a real deployment.
 */
export default async function DevCheckout({
  searchParams,
}: {
  searchParams: Promise<{ retailer?: string; total?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { retailer, total } = await searchParams;
  return <Fixture retailer={retailer ?? 'dia'} total={total ?? '$0,00'} />;
}
