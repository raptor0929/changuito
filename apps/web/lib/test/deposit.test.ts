import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { POST } from '../../app/api/deposit/route.ts';
import { depositorOf } from '../card.ts';
import { DEPLOYMENTS } from '../deployments.ts';
import {
  canDeposit,
  depositAddress,
  depositAsset,
  depositAssetFor,
  isMemo,
  MEMO_LENGTH,
  mintMemo,
} from '../deposit.ts';
import { networkAccess } from '../network-access.ts';
import { walletProofMessage, type WalletProof } from '../wallet-proof.ts';

const G = 'GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK';
const C = 'CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557';

describe('deposit asset', () => {
  it('RULE: is never an asset Horizon cannot show us', () => {
    // The whole deposit is "a payment arrived carrying this memo", and only a
    // classic payment has either. A token with no issuer has neither, so the
    // asset falls back to lumens rather than quoting something unobservable.
    for (const net of ['testnet', 'mainnet'] as const) {
      const asset = depositAsset(net);
      const issuerless = asset.issuer === null;
      assert.equal(issuerless, !DEPLOYMENTS[net].usdcIssuer, `${net}`);
      if (issuerless) assert.equal(asset.code, 'XLM');
    }
  });

  it('RULE: is the classic USDC on testnet too, so preview rehearses mainnet', () => {
    // This said "is native XLM on the test network today" until preview
    // started paying for real. Testnet's only USDC was contracts/mock_usdc, a
    // Soroban token with no classic payment record and nowhere to put a memo,
    // so the rehearsal moved lumens while the balance widget showed USDC —
    // a seam the old comment in lib/deposit.ts named and accepted.
    //
    // scripts/setup-demo-asset.mjs closed it: a classic USDC with a locked
    // issuer and a fixed supply of a billion, held by the demo wallet. The
    // two networks now differ in exactly one thing, which issuer, and that is
    // what makes the preview payment worth watching.
    const asset = depositAsset('testnet');
    assert.notEqual(asset.issuer, null, 'testnet must not fall back to the XLM branch');
    assert.deepEqual(asset, {
      code: 'USDC',
      issuer: 'GCGV3225QTJFJ32KTPJNOR5SYANP4QWNUGKKGKVK7ILMK4QACZHJTGJB',
    });
  });

  it('RULE: and it is not the same issuer as mainnet', () => {
    // Play money and real money must never be one asset. If these ever match,
    // a preview payment would be indistinguishable from a real one on chain.
    assert.notEqual(depositAsset('testnet').issuer, depositAsset('mainnet').issuer);
  });

  it('RULE: is Circle USDC on mainnet, never lumens', () => {
    // This is the assertion that would have caught the live bug. mainnet's
    // issuer was '' for as long as it had no deploy, and depositAssetFor reads
    // any falsy issuer as native XLM — the branch that exists for testnet's
    // issuer-less Soroban token. So mainnet quoted "24.5000000 XLM" for a
    // $24.50 basket, matchDeposit accepted the native payment, and the card was
    // funded for the full amount in dollars. Nothing in the flow looked wrong.
    //
    // Asserting issuer !== null rather than just deep-equalling the pair is the
    // point: blanking the field in deployments.json fails here loudly instead
    // of quietly reverting to lumens.
    const asset = depositAsset('mainnet');
    assert.notEqual(asset.issuer, null, 'mainnet must never fall to the XLM branch');
    assert.deepEqual(asset, {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
  });

  it('becomes the classic asset the moment an issuer exists', () => {
    // The pure half of the rule above, and the only place the native branch
    // is still covered now that both networks have an issuer: '' and null
    // both mean "this network's token has no issuer", and only a real string
    // produces a classic asset. Deleting this would leave the fallback live
    // in lib/deposit.ts and untested.
    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    assert.deepEqual(depositAssetFor('USDC', issuer), { code: 'USDC', issuer });
    assert.deepEqual(depositAssetFor('USDC', ''), { code: 'XLM', issuer: null });
    assert.deepEqual(depositAssetFor('USDC', null), { code: 'XLM', issuer: null });
  });
});

describe('deposit address', () => {
  it('reads the network it was asked about', () => {
    const env = { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: G, DEPOSIT_ADDRESS_MAINNET: '' } as NodeJS.ProcessEnv;
    assert.equal(depositAddress('testnet', env), G);
    assert.equal(depositAddress('mainnet', env), null);
  });

  it('RULE: refuses anything that is not an account', () => {
    // A shopper is told to send money here. A typo that survives this check
    // is money sent into nothing, and nobody finds out until they ask.
    for (const bad of ['', '   ', 'not-an-address', C, G.slice(0, -1)]) {
      assert.equal(depositAddress('testnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: bad } as NodeJS.ProcessEnv), null, bad);
    }
  });

  it('tolerates whitespace and case, the way a pasted value arrives', () => {
    const env = { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: `  ${G.toLowerCase()}\n` } as NodeJS.ProcessEnv;
    assert.equal(depositAddress('testnet', env), G);
  });

  it('canDeposit is exactly "is there an address"', () => {
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_MAINNET: G } as NodeJS.ProcessEnv), true);
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
  });
});

describe('the deposit opens modo real without a deploy', () => {
  it('RULE: an address to pay into makes mainnet usable with no contracts', () => {
    // This is the point of splitting canDeposit off isConfigured. Mainnet has
    // no escrow and is not getting one yet; the mode switch still has to be
    // reachable, or the whole flow is a door onto a wall.
    const env = {
      NODE_ENV: 'production',
      REAL_MODE_OPEN_TO_ALL: '1',
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.deepEqual(networkAccess(G, 'mainnet', env), {
      mode: 'public',
      allowed: true,
      configured: true,
      usable: true,
    });
  });

  it('RULE: and no address still means no', () => {
    const env = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', env).usable, false);
  });

  it('RULE: the allowlist is still the wall, address or not', () => {
    // Opening the deposit must not have opened the gate. An account that is
    // not on the list is refused even with somewhere to pay.
    const env = {
      NODE_ENV: 'production',
      REAL_MODE_ALLOWLIST_ADDRESSES: C,
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', env).allowed, false);
    assert.equal(networkAccess(G, 'mainnet', env).usable, false);
  });
});

describe('the memo', () => {
  it('is short enough to survive MEMO_TEXT and to be retyped', () => {
    // 28 bytes is the ledger's limit; 8 is what someone will copy by hand
    // into a wallet without losing their place.
    assert.ok(MEMO_LENGTH <= 28);
    const memo = mintMemo();
    assert.equal(memo.length, MEMO_LENGTH);
    assert.ok(isMemo(memo));
  });

  it('RULE: has no character that reads as another', () => {
    // It gets retyped off a screen. 0/O, 1/I/l are the pairs that cost an
    // afternoon, so the alphabet has none of them.
    let all = '';
    for (let i = 0; i < 500; i += 1) all += mintMemo();
    assert.doesNotMatch(all, /[01OIL]/);
  });

  it('rejects what is not one', () => {
    for (const bad of ['', 'ABC', 'ABCDEFGHI', 'ABCDEFG0', 'abcdefgh', null, 42, undefined]) {
      assert.equal(isMemo(bad), false, String(bad));
    }
  });

  it('spreads across the alphabet', () => {
    // A generator that returns the same memo twice puts two orders on one
    // payment, and the second shopper gets the first one's groceries.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(mintMemo());
    assert.ok(seen.size > 1990, `only ${seen.size} distinct`);
  });
});

/* ------------------------------------------------------------------ *
 * The route itself, which is where the flags actually land.
 *
 * `lib/test/deposit-gate.test.ts` proves the decision; this proves the
 * handler asks for it, asks *before* it looks anything up, and writes down
 * who asked. The route reads `process.env` at request time — it has no env
 * parameter and should not grow one for a test — so these set and restore it.
 * ------------------------------------------------------------------ */

const OPERATOR = 'GDYSKGLYEO2WJSI6TWJNKEMAPLM6J5WCXH5HYRLLPIUNGOI77W22PNGB';

/** Every variable these tests touch, so a case never inherits another's. */
const TOUCHED = [
  'REAL_MODE_OPEN_TO_ALL',
  'REAL_MODE_ALLOWLIST_ADDRESSES',
  'DEPOSIT_ADDRESS_MAINNET',
  'DEPOSIT_ADDRESS_TESTNET',
  'FX_ARS_PER_USD',
] as const;

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = new Map(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
  // Pinned, so no test in this file reaches a currency API.
  process.env.FX_ARS_PER_USD = '1450';
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

function signedDeposit(kp: Keypair): WalletProof {
  const message = walletProofMessage('deposit', kp.publicKey(), Date.now());
  return { message, signature: sep53(kp, message) };
}

const ask = (body: unknown) =>
  POST(new Request('https://changuito.test/api/deposit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('POST /api/deposit under the modo real flags', () => {
  const tester = Keypair.random();
  const stranger = Keypair.random();
  const listed = { REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey(), DEPOSIT_ADDRESS_MAINNET: OPERATOR };

  it('mints for a wallet on the list that signed', async () => {
    await withEnv(listed, async () => {
      const res = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: tester.publicKey(),
        proof: signedDeposit(tester),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.network, 'mainnet');
      assert.equal(body.address, OPERATOR);
      assert.ok(isMemo(body.memo));
    });
  });

  it('refuses the same wallet when it has not signed', async () => {
    await withEnv(listed, async () => {
      const res = await ask({ centavos: 500_000, network: 'mainnet', address: tester.publicKey() });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'real_mode_session_required');
    });
  });

  it('refuses a wallet that is not on the list, signature or not', async () => {
    await withEnv(listed, async () => {
      const res = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: stranger.publicKey(),
        proof: signedDeposit(stranger),
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'network_not_allowed');
    });
  });

  it('RULE: REAL_MODE_OPEN_TO_ALL lets that same stranger in, still signed', async () => {
    // The pair of cases the flag exists for, one env apart.
    await withEnv({ REAL_MODE_OPEN_TO_ALL: '1', DEPOSIT_ADDRESS_MAINNET: OPERATOR }, async () => {
      const ok = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: stranger.publicKey(),
        proof: signedDeposit(stranger),
      });
      assert.equal(ok.status, 200);

      const unsigned = await ask({ centavos: 500_000, network: 'mainnet', address: stranger.publicKey() });
      assert.equal(unsigned.status, 401);
      assert.equal((await unsigned.json()).error, 'real_mode_session_required');
    });
  });

  it('RULE: refuses a stranger before revealing whether mainnet is set up', async () => {
    // No DEPOSIT_ADDRESS_MAINNET here. A stranger must get the same 403 they
    // would get after it is set, or the refusal is a deployment announcement.
    await withEnv({ REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() }, async () => {
      const res = await ask({ centavos: 500_000, network: 'mainnet', address: stranger.publicKey() });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'network_not_allowed');
    });
  });

  it('tells a wallet that IS allowed that the network is not configured', async () => {
    // The other half of the ordering: once past the gate, "not set up" is the
    // honest answer, and the log names the variable for whoever can fix it.
    await withEnv({ REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() }, async () => {
      const res = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: tester.publicKey(),
        proof: signedDeposit(tester),
      });
      assert.equal(res.status, 503);
    });
  });

  it('leaves modo prueba open to a guest with no wallet at all', async () => {
    await withEnv({ DEPOSIT_ADDRESS_TESTNET: OPERATOR }, async () => {
      const res = await ask({ centavos: 500_000, network: 'testnet' });
      assert.equal(res.status, 200);
    });
  });
});

describe('who the memo was issued to', () => {
  const tester = Keypair.random();

  it('is written down in a gated mode, so the card route can re-check it', async () => {
    await withEnv(
      { REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey(), DEPOSIT_ADDRESS_MAINNET: OPERATOR },
      async () => {
        const res = await ask({
          centavos: 500_000,
          network: 'mainnet',
          address: tester.publicKey(),
          proof: signedDeposit(tester),
        });
        const { memo } = await res.json();
        assert.equal(await depositorOf('mainnet', memo), tester.publicKey());
      },
    );
  });

  it('RULE: is not written down when nothing was proven', async () => {
    // Mode 'open' asks for no signature, so an address in the body is a claim
    // and nothing else. Recording it would be writing down a guess and then
    // trusting it at the card — which is why POST /api/card skips the check in
    // this mode rather than reading a record it cannot rely on.
    await withEnv({ DEPOSIT_ADDRESS_MAINNET: OPERATOR }, async () => {
      const res = await ask({ centavos: 500_000, network: 'mainnet', address: tester.publicKey() });
      assert.equal(res.status, 200);
      const { memo } = await res.json();
      assert.equal(await depositorOf('mainnet', memo), undefined);
    });
  });
});
