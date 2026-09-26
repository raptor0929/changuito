import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import {
  parseWalletProofMessage,
  signWalletProof,
  WALLET_PROOF_TTL_MS,
  type WalletIntent,
  walletProofMessage,
} from '../wallet-proof.ts';
import { verifySep53, verifyWalletProof } from '../wallet-proof-verify.ts';

const now = 1_790_000_000_000;
const buyer = Keypair.random();
const stranger = Keypair.random();
const ORDER = 'a'.repeat(64);
/**
 * Every intent there is. Not a list kept by hand: `Record<WalletIntent, …>`
 * makes the compiler refuse an incomplete one, so adding an intent to
 * wallet-proof.ts and not to this file does not typecheck.
 */
const INTENTS: Record<WalletIntent, true> = {
  login: true,
  faucet: true,
  deposit: true,
  settle: true,
  refund: true,
  card: true,
  orders: true,
  retire: true,
};
const ALL_INTENTS = Object.keys(INTENTS) as WalletIntent[];
const OTHER = 'b'.repeat(64);

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

const proof = (kp: Keypair, message: string) => ({ message, signature: sep53(kp, message) });

describe('walletProofMessage', () => {
  it('RULE: every intent that exists can be parsed back', () => {
    // Generated from the type rather than listed, because listing is how the
    // bug happened: `orders` was added to the intent table and the parser's
    // alternation was not, so a real signature over a real message came back
    // `proof_invalid` with nothing to say which half was stale. A test that
    // enumerates by hand would have been updated in the same breath as the
    // code and caught nothing.
    for (const intent of ALL_INTENTS) {
      const ref = intent === 'settle' || intent === 'refund' ? ORDER : undefined;
      const parsed = parseWalletProofMessage(walletProofMessage(intent, buyer.publicKey(), now, ref));
      assert.equal(parsed?.intent, intent, `${intent} did not parse back`);
    }
  });

  it('round-trips every intent', () => {
    for (const intent of ['login', 'faucet', 'deposit', 'card', 'orders', 'retire'] as const) {
      assert.deepEqual(parseWalletProofMessage(walletProofMessage(intent, buyer.publicKey(), now)), {
        intent,
        address: buyer.publicKey(),
        issuedAt: now,
      });
    }
    for (const intent of ['settle', 'refund'] as const) {
      assert.deepEqual(parseWalletProofMessage(walletProofMessage(intent, buyer.publicKey(), now, ORDER)), {
        intent,
        address: buyer.publicKey(),
        issuedAt: now,
        ref: ORDER,
      });
    }
  });

  it('reads as Spanish to the person approving it in a wallet', () => {
    assert.match(walletProofMessage('refund', buyer.publicKey(), now, ORDER), /^Changuito: reembolsar la orden a{64} con G/);
  });

  it('rejects anything else, including an order intent with no order', () => {
    assert.equal(parseWalletProofMessage('hola'), null);
    assert.equal(parseWalletProofMessage(walletProofMessage('login', buyer.publicKey(), now) + ' extra'), null);
    assert.equal(parseWalletProofMessage(walletProofMessage('settle', buyer.publicKey(), now)), null);
  });
});

describe('verifySep53', () => {
  it('accepts the wallet’s own signature and nobody else’s', () => {
    const message = walletProofMessage('login', buyer.publicKey(), now);
    const signature = sep53(buyer, message);
    assert.equal(verifySep53(buyer.publicKey(), message, signature), true);
    assert.equal(verifySep53(stranger.publicKey(), message, signature), false);
    assert.equal(verifySep53(buyer.publicKey(), message + '.', signature), false);
    assert.equal(verifySep53(buyer.publicKey(), message, 'bm9wZQ=='), false);
    assert.equal(verifySep53('not-an-address', message, signature), false);
  });
});

describe('verifyWalletProof', () => {
  const check = (p: unknown, intent: 'login' | 'settle' | 'refund' = 'login', ref?: string, at = now) =>
    verifyWalletProof({ intent, address: buyer.publicKey(), proof: p as never, now: at, ref });

  it('accepts a fresh proof for the right intent, wallet and order', () => {
    assert.deepEqual(check(proof(buyer, walletProofMessage('login', buyer.publicKey(), now))), { ok: true });
    assert.deepEqual(check(proof(buyer, walletProofMessage('refund', buyer.publicKey(), now, ORDER)), 'refund', ORDER), { ok: true });
  });

  it('says a proof is missing when there is none', () => {
    for (const p of [undefined, null, {}, { message: 'x' }, { signature: 'y' }]) {
      assert.deepEqual(check(p), { ok: false, error: 'proof_missing' });
    }
  });

  it('will not let one intent stand in for another', () => {
    const login = proof(buyer, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(login, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
    const refund = proof(buyer, walletProofMessage('refund', buyer.publicKey(), now, ORDER));
    assert.deepEqual(check(refund, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
  });

  it('will not let a proof for one order close another', () => {
    const p = proof(buyer, walletProofMessage('settle', buyer.publicKey(), now, OTHER));
    assert.deepEqual(check(p, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
  });

  it('refuses a stranger signing in the buyer’s name', () => {
    const p = proof(stranger, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(p), { ok: false, error: 'proof_invalid' });
  });

  it('refuses a stale proof and one from too far ahead', () => {
    const p = proof(buyer, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(p, 'login', undefined, now + WALLET_PROOF_TTL_MS + 1), { ok: false, error: 'proof_expired' });
    const ahead = proof(buyer, walletProofMessage('login', buyer.publicKey(), now + 5 * 60_000));
    assert.deepEqual(check(ahead), { ok: false, error: 'proof_expired' });
  });
});

describe('signWalletProof', () => {
  it('returns null when the wallet declines or throws', async () => {
    assert.equal(await signWalletProof(async () => null, 'login', buyer.publicKey()), null);
    assert.equal(await signWalletProof(async () => { throw new Error('no'); }, 'login', buyer.publicKey()), null);
  });

  it('pairs the message it built with the signature', async () => {
    const p = await signWalletProof(async (m) => sep53(buyer, m), 'login', buyer.publicKey(), undefined, now);
    assert.ok(p);
    assert.deepEqual(verifyWalletProof({ intent: 'login', address: buyer.publicKey(), proof: p, now }), { ok: true });
  });
});

describe('the card intent', () => {
  // This is the only proof that hands back a PAN without a deposit in flight,
  // so the separation between it and every other intent is the whole guarantee
  // — see the header of app/api/card/mine/route.ts.

  it('RULE: no other intent can be replayed as a card proof', () => {
    for (const intent of ['login', 'faucet', 'deposit'] as const) {
      const p = proof(buyer, walletProofMessage(intent, buyer.publicKey(), now));
      assert.deepEqual(
        verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now }),
        { ok: false, error: 'proof_invalid' },
        `a ${intent} proof was accepted as a card proof`,
      );
    }
    for (const intent of ['settle', 'refund'] as const) {
      const p = proof(buyer, walletProofMessage(intent, buyer.publicKey(), now, ORDER));
      assert.deepEqual(
        verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now }),
        { ok: false, error: 'proof_invalid' },
        `a ${intent} proof was accepted as a card proof`,
      );
    }
  });

  it('RULE: a card proof cannot be spent on anything else', () => {
    const p = proof(buyer, walletProofMessage('card', buyer.publicKey(), now));
    for (const intent of ['login', 'faucet', 'deposit'] as const) {
      assert.equal(
        verifyWalletProof({ intent, address: buyer.publicKey(), proof: p, now }).ok,
        false,
        `a card proof was accepted as a ${intent} proof`,
      );
    }
  });

  it('accepts the real thing', () => {
    const p = proof(buyer, walletProofMessage('card', buyer.publicKey(), now));
    assert.deepEqual(verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now }), { ok: true });
  });

  it('RULE: is one wallet\'s card, not whoever holds the signature', () => {
    // The route never takes a card id, so the address in the message is the
    // only thing that selects a card. A proof signed by somebody else for
    // their own address must not read this wallet's card.
    const theirs = proof(stranger, walletProofMessage('card', stranger.publicKey(), now));
    assert.equal(verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: theirs, now }).ok, false);

    // Nor a message naming this wallet but signed by another key.
    const forged = proof(stranger, walletProofMessage('card', buyer.publicKey(), now));
    assert.deepEqual(verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: forged, now }), {
      ok: false,
      error: 'proof_invalid',
    });
  });

  it('goes stale, so a captured signature is not a standing key to the PAN', () => {
    const p = proof(buyer, walletProofMessage('card', buyer.publicKey(), now));
    assert.deepEqual(
      verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now: now + WALLET_PROOF_TTL_MS + 1 }),
      { ok: false, error: 'proof_expired' },
    );
  });

  it('carries no order id, and is refused if one is smuggled in', () => {
    const smuggled = `Changuito: ver los datos de mi tarjeta ${ORDER} con ${buyer.publicKey()} (${new Date(now).toISOString()})`;
    assert.equal(parseWalletProofMessage(smuggled), null);
  });
});
