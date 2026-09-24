import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { authorizeFaucet, faucetAccess, faucetAllowlist, faucetMode, verifySep53 } from '../faucet-auth.ts';
import { FAUCET_PROOF_TTL_MS, faucetProofMessage, parseFaucetProofMessage } from '../faucet-proof.ts';

const now = 1_790_000_000_000;
const tester = Keypair.random();
const stranger = Keypair.random();

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

function proofFor(kp: Keypair, address = kp.publicKey(), at = now) {
  const message = faucetProofMessage(address, at);
  return { message, signature: sep53(kp, message) };
}

const prod = { NODE_ENV: 'production', FAUCET_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv;

describe('faucet mode', () => {
  it('is disabled in production when nobody is on the list', () => {
    assert.equal(faucetMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), 'disabled');
    assert.equal(faucetMode({ NODE_ENV: 'production', FAUCET_ALLOWLIST_ADDRESSES: '  ,  ' } as NodeJS.ProcessEnv), 'disabled');
  });

  it('stays open for local development with no list', () => {
    assert.equal(faucetMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), 'open');
  });

  it('uses the list whenever there is one, in any environment', () => {
    assert.equal(faucetMode(prod), 'allowlist');
    assert.equal(faucetMode({ NODE_ENV: 'development', FAUCET_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv), 'allowlist');
  });

  it('reads commas, spaces and newlines, and drops what is not a G… address', () => {
    const list = faucetAllowlist({
      NODE_ENV: 'production',
      FAUCET_ALLOWLIST_ADDRESSES: `${tester.publicKey()},\n ${stranger.publicKey().toLowerCase()} tester@example.com CABC`,
    } as NodeJS.ProcessEnv);
    assert.deepEqual([...list].sort(), [tester.publicKey(), stranger.publicKey()].sort());
  });

  it('tells the widget whether to show the button', () => {
    assert.deepEqual(faucetAccess(tester.publicKey(), prod), { mode: 'allowlist', allowed: true });
    assert.deepEqual(faucetAccess(stranger.publicKey(), prod), { mode: 'allowlist', allowed: false });
    assert.deepEqual(faucetAccess(tester.publicKey(), { NODE_ENV: 'production' } as NodeJS.ProcessEnv), { mode: 'disabled', allowed: false });
  });
});

describe('proof message', () => {
  it('round-trips the address and the moment', () => {
    assert.deepEqual(parseFaucetProofMessage(faucetProofMessage(tester.publicKey(), now)), { address: tester.publicKey(), issuedAt: now });
  });

  it('rejects anything else', () => {
    assert.equal(parseFaucetProofMessage('hola'), null);
    assert.equal(parseFaucetProofMessage(faucetProofMessage(tester.publicKey(), now) + ' extra'), null);
  });
});

describe('verifySep53', () => {
  it('accepts the wallet’s own signature and nobody else’s', () => {
    const { message, signature } = proofFor(tester);
    assert.equal(verifySep53(tester.publicKey(), message, signature), true);
    assert.equal(verifySep53(stranger.publicKey(), message, signature), false);
    assert.equal(verifySep53(tester.publicKey(), message + '.', signature), false);
    assert.equal(verifySep53(tester.publicKey(), message, 'bm9wZQ=='), false);
    assert.equal(verifySep53('not-an-address', message, signature), false);
  });
});

describe('authorizeFaucet', () => {
  const run = (address: string, proof: unknown, env = prod, at = now) =>
    authorizeFaucet({ address, proof: proof as never, now: at, env });

  it('lets the allowlisted tester through with a fresh signature', () => {
    assert.deepEqual(run(tester.publicKey(), proofFor(tester)), { ok: true });
  });

  it('refuses everyone when production has no list, before looking at a proof', () => {
    const r = run(tester.publicKey(), proofFor(tester), { NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    assert.equal(r.ok === false && r.status, 403);
    assert.equal(r.ok === false && r.error, 'faucet_disabled');
  });

  it('refuses a stranger’s own wallet with 403, signature or not', () => {
    for (const proof of [undefined, proofFor(stranger)]) {
      const r = run(stranger.publicKey(), proof);
      assert.equal(r.ok === false && r.status, 403);
      assert.equal(r.ok === false && r.error, 'faucet_not_allowed');
    }
  });

  it('asks for a session when the tester’s address arrives without a proof', () => {
    // The address alone is something anyone can type.
    for (const proof of [undefined, null, {}, { message: 'x' }, { signature: 'y' }]) {
      const r = run(tester.publicKey(), proof);
      assert.equal(r.ok === false && r.status, 401);
      assert.equal(r.ok === false && r.error, 'faucet_session_required');
    }
  });

  it('refuses a stranger signing for the tester’s address', () => {
    const message = faucetProofMessage(tester.publicKey(), now);
    const r = run(tester.publicKey(), { message, signature: sep53(stranger, message) });
    assert.equal(r.ok === false && r.status, 401);
  });

  it('refuses a proof made for another address', () => {
    const r = run(tester.publicKey(), proofFor(tester, stranger.publicKey()));
    assert.equal(r.ok === false && r.error, 'faucet_proof_invalid');
  });

  it('refuses a stale proof, and one from too far in the future', () => {
    const old = run(tester.publicKey(), proofFor(tester), prod, now + FAUCET_PROOF_TTL_MS + 1);
    assert.equal(old.ok === false && old.error, 'faucet_proof_expired');
    const future = run(tester.publicKey(), proofFor(tester, tester.publicKey(), now + 5 * 60_000));
    assert.equal(future.ok === false && future.error, 'faucet_proof_expired');
  });

  it('needs nothing in open (local) mode', () => {
    assert.deepEqual(run(stranger.publicKey(), undefined, { NODE_ENV: 'development' } as NodeJS.ProcessEnv), { ok: true });
  });
});
