import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, NETWORK_IDS } from '../deployments.ts';
import { authorizeFaucet, faucetAccess, faucetAllowlist, faucetMode, faucetOnNetwork } from '../faucet-auth.ts';
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

  it('RULE: FAUCET_OPEN_TO_ALL overrides the list, it does not lose to it', () => {
    // A list left over from an earlier tester round must not quietly keep
    // everybody else out after somebody has said "open it up".
    const open = { NODE_ENV: 'production', FAUCET_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(faucetMode(open), 'public');
    assert.equal(faucetMode({ ...prod, FAUCET_OPEN_TO_ALL: 'true' } as NodeJS.ProcessEnv), 'public');
    assert.equal(faucetAccess(stranger.publicKey(), open, 'testnet').allowed, true);
  });

  it('is not opened by a flag set to a no-word', () => {
    for (const off of ['', 'false', '0', 'off']) {
      assert.equal(faucetMode({ NODE_ENV: 'production', FAUCET_OPEN_TO_ALL: off } as NodeJS.ProcessEnv), 'disabled');
    }
  });

  it('RULE: opening the faucet to everyone still does not waive the signature', () => {
    // "Anybody may ask" and "nobody has to prove anything" are different
    // sentences and only the first one was asked for. The grants share one
    // hourly ceiling, so an unauthenticated faucet is a way for one script to
    // spend every tester's twenty before a tester arrives.
    const open = { NODE_ENV: 'production', FAUCET_OPEN_TO_ALL: 'yes' } as NodeJS.ProcessEnv;
    const address = stranger.publicKey();
    const bare = authorizeFaucet({ address, now, env: open, net: 'testnet' });
    assert.equal(bare.ok, false);
    assert.equal(bare.ok === false && bare.status, 401);

    const signed = authorizeFaucet({ address, proof: proofFor(stranger), now, env: open, net: 'testnet' });
    assert.equal(signed.ok, true);

    // And it is still that wallet's signature, not any signature.
    const forged = authorizeFaucet({ address, proof: proofFor(tester, address), now, env: open, net: 'testnet' });
    assert.equal(forged.ok, false);
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

describe('the faucet is a testnet idea', () => {
  it('RULE: exists only where there is a friendbot', () => {
    assert.equal(faucetOnNetwork(DEFAULT_NETWORK), true, 'the demo has to be fundable');
    for (const net of NETWORK_IDS) {
      if (net === DEFAULT_NETWORK) continue;
      assert.equal(faucetOnNetwork(net), false, `no free money on ${net}`);
      // The widget reads this and leaves the button out; no new conditional.
      assert.deepEqual(faucetAccess(tester.publicKey(), prod, net), { mode: 'disabled', allowed: false });
    }
  });

  it('RULE: refuses to mint in modo real even for somebody allowlisted, with a proof', () => {
    for (const net of NETWORK_IDS) {
      if (net === DEFAULT_NETWORK) continue;
      const auth = authorizeFaucet({ address: tester.publicKey(), proof: proofFor(tester), now, env: prod, net });
      assert.equal(auth.ok, false);
      assert.equal(auth.ok === false && auth.status, 403);
      assert.equal(auth.ok === false && auth.error, 'faucet_not_on_network');
    }
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

  it('refuses a proof signed for another purpose', () => {
    // A login signature must not double as permission to mint.
    const message = walletProofMessage('login', tester.publicKey(), now);
    const r = run(tester.publicKey(), { message, signature: sep53(tester, message) });
    assert.equal(r.ok === false && r.error, 'faucet_proof_invalid');
  });

  it('refuses a stale proof, and one from too far in the future', () => {
    const old = run(tester.publicKey(), proofFor(tester), prod, now + WALLET_PROOF_TTL_MS + 1);
    assert.equal(old.ok === false && old.error, 'faucet_proof_expired');
    const future = run(tester.publicKey(), proofFor(tester, tester.publicKey(), now + 5 * 60_000));
    assert.equal(future.ok === false && future.error, 'faucet_proof_expired');
  });

  it('needs nothing in open (local) mode', () => {
    assert.deepEqual(run(stranger.publicKey(), undefined, { NODE_ENV: 'development' } as NodeJS.ProcessEnv), { ok: true });
  });
});
