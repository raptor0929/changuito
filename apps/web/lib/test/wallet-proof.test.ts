import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import {
  parseWalletProofMessage,
  signWalletProof,
  WALLET_PROOF_TTL_MS,
  walletProofMessage,
} from '../wallet-proof.ts';
import { verifySep53, verifyWalletProof } from '../wallet-proof-verify.ts';

const now = 1_790_000_000_000;
const buyer = Keypair.random();
const stranger = Keypair.random();
const ORDER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

const proof = (kp: Keypair, message: string) => ({ message, signature: sep53(kp, message) });

describe('walletProofMessage', () => {
  it('round-trips every intent', () => {
    for (const intent of ['login', 'faucet'] as const) {
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
