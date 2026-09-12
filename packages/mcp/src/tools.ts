import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { linkAccount, sessionStatus, unlinkAccount } from './checkout/auth.js';
import { vaultExists } from './secure/vault.js';
import { withSession } from './checkout/browser.js';
import { buildCart, describeCart, handoffUrl } from './checkout/cart.js';
import { driveToPayment, isEscalation, payAndConfirm } from './checkout/purchase.js';
import {
  type AppConfig,
  ConfigError,
  describeConfig,
  loadConfig,
  passphraseFromEnv,
  requirePassphrase,
} from './config.js';
import {
  advance,
  checkApproval,
  describeDraft,
  getDraft,
  invalidateApprovals,
  requireStage,
  setDraft,
  updateDraft,
} from './order.js';
import { EphemeralCard } from './pay/ephemeral-card.js';
import { decideFunding, explainFunding } from './pay/funding.js';
import { getArsPerUsd } from './pay/fx.js';
import type { Bin } from './pay/types.js';
import { formatUsd, VyrionClient } from './pay/vyrion.js';
import { ensureCart, getLocation } from './session.js';
import type { DeliveryAddress } from './types.js';
import { describeTransfer, sendFunds, viewWallet } from './wallet/evm.js';
import { formatARS, parseARS } from './util/money.js';
import { canPurchase, readiness, renderReadiness, setupGuidePath, setupRef } from './onboarding.js';

/**
 * The checkout half of the MCP surface.
 *
 * It lives apart from index.ts for two reasons. The read-only search tools must
 * keep working when the checkout configuration is absent or wrong — a missing
 * VYRION_API_KEY should not stop anyone searching for milk — so the config is
 * loaded lazily, per call, rather than at import. And every tool here is a thin
 * shell over something already tested: the gating is `order.ts`, the money is
 * `funding.ts`, the driving is `purchase.ts`. The handlers below decide
 * nothing; they translate.
 */

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const text = (s: string): ToolResult => ({ content: [{ type: 'text' as const, text: s }] });
const fail = (s: string): ToolResult => ({ content: [{ type: 'text' as const, text: s }], isError: true });

/**
 * One place where a thrown thing becomes something the user can act on. An
 * Escalation is not a crash — it is the loop stopping to ask a question — so it
 * is rendered in full, screenshot path and all.
 */
export function explain(e: unknown): string {
  if (isEscalation(e)) {
    return [e.message, e.summary ? `\n${e.summary}` : '', e.screenshotPath ? `\nScreenshot: ${e.screenshotPath}` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (e instanceof ConfigError) return `${e.message}\n\n${setupRef('Configuration reference')}`;
  return e instanceof Error ? e.message : String(e);
}

const guard = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (e) {
    return fail(explain(e));
  }
};

// ---------------------------------------------------------------- helpers

/** Only Día has been driven through a real checkout. The rest stay read-only. */
export function assertCheckoutSupported(cfg: AppConfig): void {
  if (cfg.retailer !== 'dia') {
    throw new Error(
      `Checkout is implemented for Día only; RETAILER is "${cfg.retailer}". ` +
        'Search and cart building work everywhere, but nothing here will pay at ' +
        `${cfg.host}. Set RETAILER=dia to use the checkout tools.`,
    );
  }
}

export function vyrionFrom(cfg: AppConfig): VyrionClient {
  return new VyrionClient({
    apiKey: cfg.vyrion.apiKey,
    baseUrl: cfg.vyrion.baseUrl,
    allowLive: cfg.vyrion.allowLive,
  });
}

/**
 * `bins()` already returns 3DS-capable BINs ranked best-first, so "the first
 * one" is the right default. An explicit id wins, because walking down the list
 * after a decline is a thing the user does by hand.
 */
export function pickBin(bins: Bin[], preferredId?: string): Bin {
  if (preferredId) {
    const hit = bins.find((b) => b.id === preferredId);
    if (!hit) {
      throw new Error(
        `BIN "${preferredId}" is not in the 3DS-capable list. Available: ${bins.map((b) => b.id).join(', ') || '(none)'}.`,
      );
    }
    return hit;
  }
  const first = bins[0];
  if (!first) {
    throw new Error(
      'Vyrion returned no 3DS-capable BINs. A card without 3DS will be refused at ' +
        'an Argentine gateway, so there is nothing safe to create here.',
    );
  }
  return first;
}

export interface AddressInput {
  street: string;
  number: string;
  postal_code: string;
  complement?: string;
  city?: string;
  state?: string;
  reference?: string;
  phone?: string;
  receiver_name?: string;
}

/**
 * Pure. Note what is *not* here: no name and no DNI. Both are read from the
 * user's own Día profile at run time, because Día requires a DNI at account
 * creation and asking for it again would be collecting an identity document we
 * have no reason to hold.
 */
export function toDeliveryAddress(i: AddressInput): DeliveryAddress {
  const street = i.street.trim();
  const number = i.number.trim();
  const postalCode = i.postal_code.trim().toUpperCase().replace(/\s+/g, '');

  if (!street) throw new Error('The street name is required.');
  if (!number) throw new Error('The street number is required. Use "S/N" if there genuinely is none.');
  // CPA (A1234ABC) or the older four-digit form. Anything else will be rejected
  // by the store after a browser round trip, which is a slow way to find out.
  if (!/^([A-Z]\d{4}[A-Z]{3}|\d{4})$/.test(postalCode)) {
    throw new Error(
      `"${i.postal_code}" is not an Argentine postal code. Use four digits (1425) ` +
        'or the CPA form (C1425DKE).',
    );
  }

  return {
    street,
    number,
    postalCode,
    ...(i.complement?.trim() ? { complement: i.complement.trim() } : {}),
    ...(i.city?.trim() ? { city: i.city.trim() } : {}),
    ...(i.state?.trim() ? { state: i.state.trim() } : {}),
    ...(i.reference?.trim() ? { reference: i.reference.trim() } : {}),
    ...(i.phone?.trim() ? { phone: i.phone.trim() } : {}),
    ...(i.receiver_name?.trim() ? { receiverName: i.receiver_name.trim() } : {}),
  };
}

/**
 * The prices and stock in the cart were fetched for the `set_location` postal
 * code. Delivering somewhere else is allowed, but it is worth saying out loud,
 * because the total can move once the store re-quotes shipping.
 */
export function postalCodeNote(addr: DeliveryAddress, searchedCp?: string): string | undefined {
  if (!searchedCp) return undefined;
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);
  if (digits(addr.postalCode) === digits(searchedCp)) return undefined;
  return (
    `Heads up: you searched with postal code ${searchedCp} but this address is ` +
    `${addr.postalCode}. Prices, stock and shipping are quoted per area, so the ` +
    'total may change. review_order shows the figure that will actually be charged.'
  );
}

/**
 * Loose equality for a restated asset amount: "1.5" and "1.50" are the same
 * number. Anything that is not plainly a number is not equal to anything —
 * including another unreadable string — because `Number('')` is 0 and an empty
 * confirmation must never read as a match.
 */
export function sameAmount(a: string, b: string): boolean {
  const n = (s: string): number | undefined => {
    const cleaned = String(s).replace(/[\s,_]/g, '');
    return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : undefined;
  };
  const x = n(a);
  const y = n(b);
  return x !== undefined && y !== undefined && x === y;
}

/** The cardholder name the payment form wants, read from the store's own profile. */
export function holderNameFrom(profile: { firstName?: string; lastName?: string } | undefined): string {
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  if (!name) {
    throw new Error(
      'Your Día profile does not give a first and last name, and the card form ' +
        'requires one. Add it to your account at the store and re-run ' +
        'link_marketplace_account.',
    );
  }
  return name;
}

// ---------------------------------------------------------------- tools

export function registerCheckoutTools(server: McpServer): void {
  server.registerTool(
    'diagnose',
    {
      title: 'Check setup and show what to do next',
      description:
        'Report what is configured, what is still missing, and the next concrete step. ' +
        'Shows no secret values. Run this first on a new install, and whenever a tool ' +
        'reports a configuration problem.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        // Deliberately tolerant: a broken config is the most likely reason
        // someone is running this, so it must still produce a checklist.
        let cfg: AppConfig | undefined;
        let configError: string | undefined;
        try {
          cfg = loadConfig();
        } catch (e) {
          configError = explain(e);
        }
        if (!cfg) {
          return text(
            `Configuration could not be loaded, so nothing else can run yet.\n\n${configError}`,
          );
        }

        // A passphrase that is set but too short is its own diagnosis, and
        // diagnose must report it rather than fail on it.
        let sessionPassphraseSet = false;
        let passphraseNote: string | undefined;
        try {
          sessionPassphraseSet = Boolean(passphraseFromEnv('SESSION_PASSPHRASE'));
        } catch (e) {
          passphraseNote = explain(e);
        }

        const steps = readiness({
          cfg,
          sessionExists: await vaultExists(cfg.sessionVaultPath),
          sessionPassphraseSet,
        });

        return text(
          [
            renderReadiness(steps),
            passphraseNote ? `\n⚠ ${passphraseNote}` : undefined,
            '',
            describeConfig(cfg),
            '',
            describeDraft(),
            canPurchase(steps) ? undefined : `\nFull guide: ${setupGuidePath()}`,
          ]
            .filter((s) => s !== undefined)
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'link_marketplace_account',
    {
      title: 'Log in to the supermarket yourself',
      description:
        'Open a real browser window at the store login page and wait for YOU to sign in. ' +
        'Your password is never read, typed or stored by this server — you type it into the ' +
        'window. The resulting session cookies are saved encrypted and reused for everything else.',
      inputSchema: {
        timeout_minutes: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(5)
          .describe('How long the window waits for you before giving up.'),
      },
    },
    async ({ timeout_minutes }) =>
      guard(async () => {
        const cfg = loadConfig();
        assertCheckoutSupported(cfg);
        const passphrase = requirePassphrase('SESSION_PASSPHRASE');
        const r = await linkAccount(cfg, passphrase, { timeoutMs: timeout_minutes * 60_000 });
        if (r.linked) setDraft(advance(getDraft(), 'linked'));
        return text(
          [
            r.message,
            r.hasDocument
              ? 'Your DNI is on the profile, so the payment form can be filled without asking you for it.'
              : 'Your profile has no DNI on it. If the card form asks for one, the run will stop and ask.',
            r.linked ? '\nNext: set_delivery_address.' : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'session_status',
    {
      title: 'Is the supermarket session still good?',
      description:
        'Report whether a saved session exists and whether it has expired. With check_live it ' +
        'also asks the store, which catches a server-side logout the cookies cannot show.',
      inputSchema: {
        check_live: z.boolean().default(false).describe('Open a browser and ask the store too.'),
      },
    },
    async ({ check_live }) =>
      guard(async () => {
        const cfg = loadConfig();
        const passphrase = requirePassphrase('SESSION_PASSPHRASE');
        const r = await sessionStatus(cfg, passphrase, { live: check_live });
        return text(r.message);
      }),
  );

  server.registerTool(
    'unlink_marketplace_account',
    {
      title: 'Forget the saved session',
      description: 'Delete the encrypted session file. The only way to log out from this side.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const cfg = loadConfig();
        const gone = await unlinkAccount(cfg);
        setDraft({ stage: 'searching' });
        return text(
          gone
            ? 'Session deleted. Nothing of your account remains on this machine.'
            : 'There was no saved session to delete.',
        );
      }),
  );

  server.registerTool(
    'set_delivery_address',
    {
      title: 'Give the delivery address',
      description:
        'Record where the order should be delivered. Your name and DNI are NOT asked for here — ' +
        'they are read from your own store profile when the forms need them.',
      inputSchema: {
        street: z.string().describe('Street name only, without the number.'),
        number: z.string().describe('Street number. "S/N" if there is none.'),
        postal_code: z.string().describe('Four digits (1425) or CPA (C1425DKE).'),
        complement: z.string().optional().describe('Piso / depto.'),
        city: z.string().optional(),
        state: z.string().optional().describe('Provincia.'),
        reference: z.string().optional().describe('Entre calles, a landmark — whatever helps the driver.'),
        phone: z.string().optional(),
        receiver_name: z.string().optional().describe('If somebody else will take delivery.'),
      },
    },
    async (input) =>
      guard(async () => {
        loadConfig();
        requireStage('set_delivery_address');
        const address = toDeliveryAddress(input as AddressInput);

        // An address change re-quotes shipping, so any total already approved
        // is no longer a total anybody approved.
        const d = updateDraft({ ...invalidateApprovals(getDraft()), address });
        setDraft(advance(d, 'addressed'));

        const note = postalCodeNote(address, getLocation()?.postalCode);
        return text(
          [
            `Delivering to: ${address.street} ${address.number}` +
              `${address.complement ? `, ${address.complement}` : ''}, CP ${address.postalCode}` +
              `${address.city ? `, ${address.city}` : ''}.`,
            note ?? '',
            '\nNext: build_cart.',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'build_cart',
    {
      title: 'Put the items into your real store cart',
      description:
        'Add the chosen SKUs to the cart of the account you logged in to, using your own ' +
        'session. This changes your real cart at the store. It does not pay for anything. ' +
        'With no items given, it copies whatever the anonymous cart from add_to_cart holds.',
      inputSchema: {
        items: z
          .array(
            z.object({
              sku_id: z.string(),
              quantity: z.number().int().min(1).default(1),
              seller_id: z.string().default('1'),
            }),
          )
          .optional()
          .describe('Leave empty to use the cart built with add_to_cart.'),
        clear_first: z
          .boolean()
          .default(false)
          .describe('Empty your existing store cart first. Off by default — your list is yours.'),
      },
    },
    async ({ items, clear_first }) =>
      guard(async () => {
        const cfg = loadConfig();
        assertCheckoutSupported(cfg);
        requireStage('build_cart');
        const passphrase = requirePassphrase('SESSION_PASSPHRASE');

        const wanted =
          items && items.length > 0
            ? items.map((i) => ({ skuId: i.sku_id, quantity: i.quantity, sellerId: i.seller_id }))
            : (await ensureCart()).cart.lines.map((l) => ({
                skuId: l.skuId,
                quantity: l.quantity,
                sellerId: l.sellerId,
              }));

        if (wanted.length === 0) {
          return fail('Nothing to add. Use search_products and add_to_cart first, or pass items here.');
        }

        const r = await withSession(cfg, passphrase, (run) =>
          buildCart(run.page.request, cfg, wanted, { clearFirst: clear_first }),
        );

        const d = invalidateApprovals(getDraft());
        setDraft(advance({ ...d, orderFormId: r.orderFormId, cartUrl: r.handoffUrl }, 'cart_built'));

        return text(`${describeCart(r)}\n\nNext: review_order.`);
      }),
  );

  server.registerTool(
    'review_order',
    {
      title: 'Drive the checkout to the payment step and show the total',
      description:
        'Walks your real checkout as far as the card form and stops there. No card is created ' +
        'and nothing is submitted. Returns the itemized total, what the store flagged, and a ' +
        'link that opens this exact cart in your own browser.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const cfg = loadConfig();
        assertCheckoutSupported(cfg);
        const draft = requireStage('review_order');
        const passphrase = requirePassphrase('SESSION_PASSPHRASE');

        const r = await withSession(cfg, passphrase, (run) =>
          driveToPayment(run, cfg, { orderFormId: draft.orderFormId, address: draft.address }),
        );

        if (!r.flow.reached) {
          // Deliberately does not advance: nothing here is a total anyone can approve.
          return fail(`${r.summary}\n\nNothing was paid and no card exists.`);
        }

        setDraft(
          advance(
            { ...getDraft(), totalCentavos: r.totalCentavos, cartUrl: r.cartUrl },
            'reviewed',
          ),
        );

        const rows = r.breakdown.map((b) => `  ${b.name.padEnd(24)} ${formatARS(b.centavos)}`);
        return text(
          [
            r.summary,
            ...(rows.length ? ['', ...rows] : []),
            '',
            `To pay, restate this exact amount: ${formatARS(r.totalCentavos)}`,
            'Next: check_funds.',
          ].join('\n'),
        );
      }),
  );

  server.registerTool(
    'check_funds',
    {
      title: 'Is there enough settled balance to pay?',
      description:
        'Convert the reviewed ARS total to USD, add the FX buffer, and compare it against the ' +
        'SETTLED Vyrion balance. Pending deposits are shown but never counted — an unconfirmed ' +
        'deposit is not money you have.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const cfg = loadConfig();
        const draft = requireStage('check_funds');
        if (draft.totalCentavos === undefined) {
          return fail('No reviewed total. Run review_order first.');
        }

        const client = vyrionFrom(cfg);
        const [balance, fx] = await Promise.all([
          client.walletBalance(),
          getArsPerUsd({ override: cfg.fx.override }),
        ]);

        const plan = decideFunding({
          arsTotal: draft.totalCentavos,
          arsPerUsd: fx.arsPerUsd,
          settledUsdCents: balance.settled,
          pendingUsdCents: balance.pending,
          buffer: cfg.fx.buffer,
        });

        setDraft(advance({ ...getDraft(), plan }, 'funds_checked'));

        const next =
          plan.status === 'ready'
            ? `\nNext: approve_payment, restating ${formatARS(draft.totalCentavos)} exactly.`
            : '\nNothing will be charged until this says ready.';
        return text(`${explainFunding(plan)}\n(rate from ${fx.source})${next}`);
      }),
  );

  server.registerTool(
    'replenish_wallet',
    {
      title: 'Top up the Vyrion wallet from your own wallet',
      description:
        'Send funds from your encrypted EOA keystore to your Vyrion deposit address. ' +
        'Independent of any order and non-blocking: it returns the transaction hash without ' +
        'waiting for confirmations. Called without confirm_amount it only quotes the transfer.',
      inputSchema: {
        amount: z.string().describe('Amount in the funding asset, e.g. "25" or "25.5".'),
        confirm_amount: z
          .string()
          .optional()
          .describe('Restate the same amount to actually send it. Omit to see a quote first.'),
      },
    },
    async ({ amount, confirm_amount }) =>
      guard(async () => {
        const cfg = loadConfig();
        if (cfg.wallet.asset !== 'eth' && cfg.wallet.asset !== 'usdt') {
          return fail(
            `FUNDING_ASSET is "${cfg.wallet.asset}". This server can only sign EVM transfers ` +
              '(eth, usdt). Send that deposit by hand, or set FUNDING_ASSET=usdt.',
          );
        }

        const client = vyrionFrom(cfg);
        const [deposit, view] = await Promise.all([
          client.depositAddress(cfg.wallet.asset),
          viewWallet(cfg),
        ]);

        if (!confirm_amount) {
          return text(
            [
              describeTransfer(view, deposit.address, amount),
              '',
              'Nothing has been sent. To send it, call replenish_wallet again with ' +
                `confirm_amount: "${amount}".`,
            ].join('\n'),
          );
        }

        if (!sameAmount(amount, confirm_amount)) {
          return fail(
            `You asked to send ${amount} but confirmed ${confirm_amount}. Nothing was sent.`,
          );
        }

        const passphrase = requirePassphrase('WALLET_PASSPHRASE');
        const receipt = await sendFunds(cfg, { to: deposit.address, amount, passphrase });

        return text(
          [
            `Sent ${receipt.amount} ${receipt.symbol} to your Vyrion deposit address.`,
            `Transaction: ${receipt.hash}`,
            receipt.explorerUrl ? `Watch it: ${receipt.explorerUrl}` : '',
            '',
            'This was not waited on — it settles in the background. It will not count towards ' +
              'check_funds until Vyrion confirms it, which is why a purchase never waits on it.',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'approve_payment',
    {
      title: 'Pay for the order',
      description:
        'THE ONE TOOL THAT SPENDS MONEY. Creates a single-use virtual card funded from the ' +
        'settled Vyrion balance, pays for the reviewed cart, answers the 3D Secure challenge, ' +
        'and terminates the card so anything left over returns to the wallet. Requires the ' +
        'exact ARS total from review_order, restated by the user.',
      inputSchema: {
        confirm_total_ars: z
          .string()
          .describe('The exact total review_order showed, e.g. "12345,67". A mismatch aborts.'),
        bin_id: z
          .string()
          .optional()
          .describe('Force a specific Vyrion BIN. Defaults to the best-accepting 3DS-capable one.'),
      },
    },
    async ({ confirm_total_ars, bin_id }) =>
      guard(async () => {
        const cfg = loadConfig();
        assertCheckoutSupported(cfg);
        const draft = requireStage('approve_payment');
        const restated = parseARS(confirm_total_ars);
        checkApproval(draft, restated);

        const plan = draft.plan!;
        const passphrase = requirePassphrase('SESSION_PASSPHRASE');
        const client = vyrionFrom(cfg);
        const bin = pickBin(await client.bins(), bin_id);

        const result = await withSession(cfg, passphrase, async (run) => {
          // Re-drive rather than trusting the earlier review: the browser from
          // review_order is long closed, and the store may have moved on.
          const review = await driveToPayment(run, cfg, {
            orderFormId: draft.orderFormId,
            address: draft.address,
          });
          if (!review.flow.reached) {
            throw new Error(
              `${review.summary}\n\nNo card was created and nothing was paid.`,
            );
          }

          const holderName = holderNameFrom(run.profile);

          // The card is created only once the payment form is genuinely on
          // screen, so a failed drive never leaves funded plastic behind.
          const card = await EphemeralCard.create({
            client,
            binId: bin.id,
            amountCents: plan.requiredUsdCents,
            label: 'grocery order',
            allowedCategories: cfg.vyrion.allowedCategories,
            metadata: { orderFormId: draft.orderFormId ?? '', retailer: cfg.retailer },
          });

          try {
            return await payAndConfirm(run, cfg, {
              approvedTotalCentavos: restated,
              card,
              holderName,
              document: run.profile?.document,
              orderFormId: draft.orderFormId,
              address: draft.address,
            });
          } finally {
            // Always, on every path: an un-terminated card still holds money.
            await card.terminate();
          }
        });

        if (result.placed) {
          setDraft(
            advance(
              {
                ...getDraft(),
                confirmation: result.confirmation,
                placedAt: new Date().toISOString(),
              },
              'order_placed',
            ),
          );
        }

        return text(
          [
            result.summary,
            '',
            `Card funded with ${formatUsd(plan.requiredUsdCents)} on BIN ${bin.id} (${bin.network}), ` +
              'now terminated — whatever was not spent is back in the wallet.',
            result.placed
              ? `Verify it yourself: ${result.confirmation?.statusUrl ?? `https://${cfg.host}/account#/orders`}`
              : `Your cart is untouched and still here: ${draft.cartUrl ?? handoffUrl(cfg, draft.orderFormId ?? '')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
  );
}
