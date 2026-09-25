import { expect, test } from '@playwright/test';

import {
  CARD_CVV,
  CARD_PAN,
  CARD_PAN_GROUPED,
  DEPOSIT_ADDRESS,
  DEPOSIT_AMOUNT,
  MEMO,
  OTP_CODE,
  installCheckoutMocks,
  leaked,
  storageDump,
} from './support/checkout-fixtures';
import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * A basket becomes a paid receipt: the whole flow, once, against a scripted
 * server.
 *
 * ## What this does not prove
 *
 * **Not that a purchase happened.** There is no sandbox supermarket anywhere —
 * Día has no test store, and no VTEX retailer in this country does. So the
 * store here is `app/dev/checkout`, a same-origin fixture the modal frames in
 * Día's place in modo prueba, and every assertion past "Ya lo pagué" is about
 * what the app does *when the store says paid*. A green run means the flow is
 * correct. It does not mean anyone was charged, and a screenshot of it is not
 * a screenshot of a purchase.
 *
 * **Not the ledger, the issuer or the model.** Those three are mocked here for
 * the reasons `support/checkout-fixtures.ts` sets out. They have been
 * exercised for real elsewhere and separately:
 *
 * - the deposit, against real testnet Horizon — a 4.6600000 XLM payment
 *   carrying its código, read back and matched by `/api/deposit`;
 * - the card issue path, against the real Vyrion API with a deliberately
 *   invalid `sk_test_` key, which proved the ordering and the redaction of the
 *   provider's error and nothing beyond it. **The mint itself has never run
 *   against a live Vyrion sandbox account** — there is no such account on this
 *   project yet, and that gap is real.
 *
 * **Not the gate in front of any of it.** `installCheckoutMocks` answers
 * `/api/deposit` in the browser, so the modo real allowlist and the signature
 * it asks for (`lib/deposit-gate.ts`) are never reached here — this spec runs
 * on the default network, where by design there is nothing to reach. Both
 * settings of both flags are covered in `lib/test/deposit-gate.test.ts`, and
 * the handler's own ordering in `lib/test/deposit.test.ts`.
 *
 * Which is the testnet answer the ask wanted: two of the three legs have a
 * test mode and use it, and the third — the supermarket — has none, which is
 * why this file exists in the shape it does.
 *
 * ## Why it runs against a local server
 *
 * `app/dev/checkout` `notFound()`s in production, which is correct and is also
 * why this cannot be a production smoke like the other two specs. It has its
 * own Playwright project, with its own base URL and a dev server — see
 * `playwright.config.ts`.
 */

// This test puts a PAN, a CVV and a one-time code on screen. The repo is
// public, so nothing that records a frame of it may be on — the same reason
// `app-auth.spec.ts` turns them off. The project sets this too; it is repeated
// here so that moving the file cannot quietly lose it.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('frame checkout', () => {
  test('a basket becomes a paid receipt, and the card is given back', async ({ page }) => {
    const calls = installCheckoutMocks(page);
    const errors = collectPageErrors(page);

    await page.goto('/');

    // ---- shop -------------------------------------------------------------
    const composer = page.getByTestId('composer');
    await expect(composer).toBeVisible();
    await composer.locator('textarea').fill('Necesito leche y fideos');
    await page.getByTestId('composer-send').click();

    const thread = page.getByTestId('chat-thread');
    await expect(thread.getByText('Leche Entera La Serenísima 1L').first()).toBeVisible();
    await expect(thread.locator('.cart-total strong')).toHaveText('$5.150,00');
    // The rail is the same basket seen from the other side of the window. If
    // these two ever disagree, one of them is lying about what is in the cart.
    await expect(page.locator('.rail-cart-total strong')).toHaveText('$5.150,00');

    // ---- the importe ------------------------------------------------------
    await thread.getByRole('button', { name: 'Pagá con USDC' }).click();
    const modal = page.getByTestId('checkout-modal');
    await expect(modal).toBeVisible();

    await expect(page.getByTestId('checkout-amount')).toHaveText(`${DEPOSIT_AMOUNT} XLM`);
    await expect(page.getByTestId('checkout-address')).toHaveText(DEPOSIT_ADDRESS);
    await expect(page.getByTestId('checkout-memo')).toHaveText(MEMO);

    const status = page.getByTestId('checkout-deposit-status');
    await expect(status).toHaveText(/Esperando/);
    // Nothing can be paid before the importe lands. This is the gate.
    await expect(page.getByTestId('checkout-continue')).toBeDisabled();

    // The second poll is the one that finds it, four seconds out.
    await expect(status).toHaveText(/Llegó/, { timeout: 20_000 });
    await expect(page.getByTestId('checkout-continue')).toBeEnabled();
    await page.getByTestId('checkout-continue').click();

    // ---- the store, in a frame -------------------------------------------
    await expect(page.getByTestId('checkout-store')).toBeVisible();
    const frame = page.getByTestId('checkout-frame');
    // The rehearsal branch: modo prueba frames our fixture, never Día. If this
    // ever points at a real storefront, the rest of this test is a purchase.
    await expect(frame).toHaveAttribute('src', /^\/dev\/checkout\?retailer=dia/);
    // A security decision, not a layout one: `allow-same-origin` is what lets
    // a store keep a session, and the list is deliberately short.
    await expect(frame).toHaveAttribute('sandbox', /allow-scripts allow-forms allow-same-origin/);
    // It really is framed — the headers allow it and the page rendered.
    await expect(page.frameLocator('[data-testid="checkout-frame"]').getByTestId('fixture-pay')).toBeVisible();

    await page.getByTestId('checkout-logged-in').click();
    await expect(page.getByTestId('checkout-identified')).toBeVisible();

    // ---- the optional card ------------------------------------------------
    await expect(page.getByTestId('checkout-card')).toBeVisible();
    await page.getByTestId('checkout-card-issue').click();

    await expect(page.getByTestId('checkout-card-pan')).toHaveText(CARD_PAN_GROUPED);
    await expect(page.getByTestId('checkout-card-expiry')).toHaveText('11/29');
    await expect(page.getByTestId('checkout-card-cvv')).toHaveText(CARD_CVV);
    expect(calls.card).toBe(1);

    // The bank's code arrives on the second poll and starts running out.
    await expect(page.getByTestId('checkout-otp-code')).toHaveText(OTP_CODE, { timeout: 20_000 });
    await expect(page.locator('.ck-countdown')).toHaveText(/\d:\d\d/);

    // **The guardrail, asserted while the numbers are on screen.** They live in
    // React state and nowhere else — not localStorage, not sessionStorage. If
    // a future change persists the dialog's state wholesale, this is what
    // catches it, and `checkout-copy.ts` stops claiming "No la guardamos".
    const duringCheckout = await storageDump(page);
    expect(leaked(duringCheckout, CARD_PAN), 'a PAN reached storage').toBe(false);
    expect(leaked(duringCheckout, CARD_PAN_GROUPED), 'a PAN reached storage').toBe(false);
    expect(leaked(duringCheckout, CARD_CVV), 'a CVV reached storage').toBe(false);
    expect(leaked(duringCheckout, OTP_CODE), 'a one-time code reached storage').toBe(false);

    // ---- paid -------------------------------------------------------------
    await page.getByTestId('checkout-paid').click();
    await expect(modal).toBeHidden();
    // The store was asked before the shopper's word was taken.
    expect(calls.verify).toBe(1);
    // And the card was given back in the same breath as the receipt: a card
    // left alive is money sitting somewhere nobody is watching.
    await expect.poll(() => calls.terminate, { timeout: 10_000 }).toBe(1);

    const receipt = page.getByTestId('receipt');
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('Leche Entera La Serenísima 1L');
    await expect(receipt).toContainText('$5.150,00');
    // The rail turns into the receipt too, and carries the código — the name
    // the order has on the ledger and the only one worth quoting later.
    await expect(page.getByTestId('receipt-paid')).toBeVisible();
    await expect(page.locator('.rail-cart-ref')).toContainText(MEMO);

    // ---- one chat is one order -------------------------------------------
    await expect(page.getByTestId('composer')).toHaveCount(0);
    await expect(page.getByTestId('composer-closed')).toBeVisible();
    // The card that paid is now a record. A Pagar on it would invite paying twice.
    await expect(thread.getByRole('button', { name: 'Pagá con USDC' })).toHaveCount(0);

    // ---- and it is still there afterwards ---------------------------------
    const afterPaid = await storageDump(page);
    expect(afterPaid).toContain('"orderState":"paid"');
    expect(afterPaid).toContain(MEMO);
    expect(leaked(afterPaid, CARD_PAN), 'a PAN was written with the receipt').toBe(false);

    await page.getByTestId('composer-new-chat').click();
    await expect(page.getByTestId('composer')).toBeVisible();
    await expect(page.getByTestId('receipt')).toHaveCount(0);

    // Reload: the receipt outlives the tab, which is the whole point of
    // keeping it in storage rather than in a provider.
    await page.reload();
    const row = page.getByTestId('chat-row').first();
    await expect(row).toContainText('Necesito leche y fideos');
    await expect(row).toContainText('Pagado');

    await row.click();
    await expect(page.getByTestId('receipt')).toBeVisible();
    // Read-only, because the conversation behind it is over on both sides:
    // the order is placed and the agent's history has expired.
    await expect(page.getByTestId('composer-closed')).toBeVisible();
    await expect(page.getByTestId('composer')).toHaveCount(0);

    // The scripted server was asked for exactly one turn. A second would mean
    // the transcript came back from storage and then went to the agent again.
    expect(calls.chat).toBe(1);
    expectNoPageErrors(errors);
  });
});
