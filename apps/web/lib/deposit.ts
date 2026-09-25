import { StrKey } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';
import type { ClassicAsset } from './trustline.ts';

/**
 * The shopper's deposit: a plain Stellar payment to an account we control,
 * matched by memo.
 *
 * Why a payment and not the escrow. The escrow contract is deployed on testnet
 * only, and mainnet has no contracts at all — `isConfigured('mainnet')` is
 * false and will stay false until a deploy. But the thing the order actually
 * needs is much smaller than an escrow: the money has to arrive before a card
 * is issued against it. A classic payment with a memo does that with no
 * contract, no resolver key on the server, and nothing to deploy.
 *
 * It also means the failure path is honest. There is no automated outbound
 * payment here and no Stellar secret in the deployment, so a failed order is
 * refunded by hand. That is a worse product and a much better blast radius.
 *
 * ## Why the asset differs per network, which is not a simplification
 *
 * A memo lives on a classic Stellar transaction. `testnet.usdcIssuer` is null
 * — contracts/mock_usdc is a pure SEP-41 Soroban token, so it has no classic
 * asset, no Horizon payment record and nowhere to put a memo. Asking for mock
 * USDC here would be asking for something that cannot be observed.
 *
 * So the deposit asset is native XLM on testnet and classic USDC on mainnet.
 * One field, same code path, and it falls out of exactly the same `usdcIssuer`
 * asymmetry that lib/trustline.ts is built around. The seam it leaves is real
 * and worth knowing: in modo prueba the balance widget shows mock USDC while
 * the rehearsal deposit moves XLM. Both are play money and the copy says so.
 */

/** Native XLM has no issuer. `null` is how the rest of the code tells them apart. */
export type DepositAsset = ClassicAsset | { code: 'XLM'; issuer: null };

export function depositAsset(net: NetworkId = DEFAULT_NETWORK): DepositAsset {
  return depositAssetFor(DEPLOYMENTS[net].usdcCode, DEPLOYMENTS[net].usdcIssuer);
}

/**
 * The same answer for a code and issuer named directly. Split out for the
 * reason trustline.ts splits `trustlineFor`: DEPLOYMENTS.mainnet is empty
 * until the deploy, so the classic-asset branch is unreachable from
 * `depositAsset` today, and a test that can only run after the thing it
 * guards ships is not a tripwire.
 *
 * The annotations are load-bearing here too — DEPLOYMENTS is `as const` and
 * every `usdcIssuer` in it is currently `null` or `''`, which lets TypeScript
 * prove the truthy branch dead and narrow the argument to `never`.
 */
export function depositAssetFor(code: string, issuer: string | null): DepositAsset {
  return issuer ? { code, issuer } : { code: 'XLM', issuer: null };
}

/**
 * Where the money goes. Server-only, and read from the environment rather than
 * deployments.json for two reasons: lib/deployments.ts is generated and would
 * lose it on the next deploy, and this is an operator account that should be
 * able to differ between Preview and Production without a commit.
 *
 * The address is public by nature — it is printed on screen for the shopper to
 * pay. The secret for it is deliberately nowhere near this deployment.
 */
export function depositAddress(net: NetworkId, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (net === 'mainnet' ? env.DEPOSIT_ADDRESS_MAINNET : env.DEPOSIT_ADDRESS_TESTNET) ?? '';
  const address = raw.trim().toUpperCase();
  // A `C…` contract address cannot receive a classic payment with a memo, so
  // only an ed25519 account counts. A typo here would otherwise be discovered
  // by a shopper sending real money into nothing.
  return StrKey.isValidEd25519PublicKey(address) ? address : null;
}

/**
 * Whether this network can take a deposit at all.
 *
 * Kept apart from `isConfigured`, which answers a different question — whether
 * the *contracts* are up. Mainnet can take a deposit today and has no escrow;
 * conflating the two would gate the new flow behind a deploy that is not
 * coming, which is how modo real ended up as a door onto a wall.
 */
export function canDeposit(net: NetworkId, env: NodeJS.ProcessEnv = process.env): boolean {
  return depositAddress(net, env) !== null;
}

/**
 * The memo a deposit must carry, derived from the order id.
 *
 * MEMO_TEXT is capped at 28 bytes, so the order id cannot simply be pasted in.
 * A short random tag is minted per order and *that* is the memo; the mapping
 * lives with the order. Base32 alphabet, no padding, uppercase — memos get
 * retyped by hand into a wallet, and this one is unambiguous when they are.
 */
export const MEMO_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MEMO_LENGTH = 8;

/**
 * A uniform float in [0, 1), from the CSPRNG rather than from `Math.random`.
 *
 * The memo is not only a label. `GET /api/card/3ds` and `POST /api/card/terminate`
 * take it as a bearer token — they have to, since a shopper polling for a
 * one-time code every three seconds cannot sign for each poll — so guessing a
 * live memo is guessing a live card's 3DS feed. `Math.random` is a fast PRNG
 * whose internal state is recoverable from a handful of outputs, and this
 * function hands out outputs eight at a time to anyone who opens a checkout.
 *
 * Drawn as a 32-bit word rather than a byte with rejection sampling: 2^32 does
 * not divide 31 either, but the residual bias is about one part in 10^8 rather
 * than the 3% a byte modulo would cost, and there is no retry loop to get
 * subtly wrong. 31^8 is ~2^39.6 of keyspace, and now all of it is real.
 */
function cryptoRandom(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return word[0]! / 2 ** 32;
}

export function mintMemo(random: () => number = cryptoRandom): string {
  let out = '';
  for (let i = 0; i < MEMO_LENGTH; i += 1) {
    out += MEMO_ALPHABET[Math.floor(random() * MEMO_ALPHABET.length)];
  }
  return out;
}

export function isMemo(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === MEMO_LENGTH &&
    [...value].every((c) => MEMO_ALPHABET.includes(c))
  );
}
