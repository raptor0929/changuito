import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, NETWORK_IDS } from '../deployments.ts';
import { authorizeFaucet, faucetOnNetwork, faucetView } from '../faucet-auth.ts';
import { WALLET_PROOF_TTL_MS, walletProofMessage } from '../wallet-proof.ts';

const faucetProofMessage = (address: string, at: number) => walletProofMessage('faucet', address, at);

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

describe('faucet view', () => {
  it('hides the button unless the database admitted the wallet', () => {
    assert.deepEqual(faucetView('testnet', { admitted: false, openToAll: false }), { mode: 'disabled', allowed: false });
    assert.deepEqual(faucetView('testnet', { admitted: true, openToAll: false }), { mode: 'allowlist', allowed: true });
    assert.deepEqual(faucetView('testnet', { admitted: true, openToAll: true }), { mode: 'public', allowed: true });
  });

  it('RULE: opening the faucet to everyone still does not waive the signature', () => {
    const address = stranger.publicKey();
    const bare = authorizeFaucet({ address, now, net: 'testnet', admitted: true });
    assert.equal(bare.ok, false);
    assert.equal(bare.ok === false && bare.status, 401);

    const signed = authorizeFaucet({ address, proof: proofFor(stranger), now, net: 'testnet', admitted: true });
    assert.equal(signed.ok, true);

    const forged = authorizeFaucet({ address, proof: proofFor(tester, address), now, net: 'testnet', admitted: true });
    assert.equal(forged.ok, false);
  });
});

describe('the faucet is a testnet idea', () => {
  it('RULE: exists only where there is a friendbot', () => {
    assert.equal(faucetOnNetwork(DEFAULT_NETWORK), true, 'the demo has to be fundable');
    for (const net of NETWORK_IDS) {
      if (net === DEFAULT_NETWORK) continue;
      assert.equal(faucetOnNetwork(net), false, `no free money on ${net}`);
      assert.deepEqual(faucetView(net, { admitted: true, openToAll: true }), { mode: 'disabled', allowed: false });
    }
  });

  it('RULE: refuses to mint in modo real even for a granted wallet, with a proof', () => {
    for (const net of NETWORK_IDS) {
      if (net === DEFAULT_NETWORK) continue;
      const auth = authorizeFaucet({ address: tester.publicKey(), proof: proofFor(tester), now, net, admitted: true });
      assert.equal(auth.ok, false);
      assert.equal(auth.ok === false && auth.status, 403);
      assert.equal(auth.ok === false && auth.error, 'faucet_not_on_network');
    }
  });
});

describe('authorizeFaucet', () => {
  const run = (address: string, proof: unknown, admitted = true, at = now) =>
    authorizeFaucet({ address, proof: proof as never, now: at, admitted });

  it('lets a granted wallet through with a fresh signature', () => {
    assert.deepEqual(run(tester.publicKey(), proofFor(tester)), { ok: true });
  });

  it('refuses a wallet the database has not granted, before looking at a proof', () => {
    const r = run(tester.publicKey(), proofFor(tester), false);
    assert.equal(r.ok === false && r.status, 403);
    assert.equal(r.ok === false && r.error, 'faucet_not_allowed');
  });

  it('asks for a session when the granted address arrives without a proof', () => {
    for (const proof of [undefined, null, {}, { message: 'x' }, { signature: 'y' }]) {
      const r = run(tester.publicKey(), proof);
      assert.equal(r.ok === false && r.status, 401);
      assert.equal(r.ok === false && r.error, 'faucet_session_required');
    }
  });

  it('refuses a stranger signing for the granted address', () => {
    const message = faucetProofMessage(tester.publicKey(), now);
    const r = run(tester.publicKey(), { message, signature: sep53(stranger, message) });
    assert.equal(r.ok === false && r.status, 401);
  });

  it('refuses a proof made for another address', () => {
    const r = run(tester.publicKey(), proofFor(tester, stranger.publicKey()));
    assert.equal(r.ok === false && r.error, 'faucet_proof_invalid');
  });

  it('refuses a proof signed for another purpose', () => {
    const message = walletProofMessage('login', tester.publicKey(), now);
    const r = run(tester.publicKey(), { message, signature: sep53(tester, message) });
    assert.equal(r.ok === false && r.error, 'faucet_proof_invalid');
  });

  it('refuses a stale proof, and one from too far in the future', () => {
    const old = run(tester.publicKey(), proofFor(tester), true, now + WALLET_PROOF_TTL_MS + 1);
    assert.equal(old.ok === false && old.error, 'faucet_proof_expired');
    const future = run(tester.publicKey(), proofFor(tester, tester.publicKey(), now + 5 * 60_000));
    assert.equal(future.ok === false && future.error, 'faucet_proof_expired');
  });
});
