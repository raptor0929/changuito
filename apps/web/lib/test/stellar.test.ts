import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it } from 'node:test';

import { DEFAULT_NETWORK, DEPLOYMENTS, NETWORK_IDS, asNetwork, deployment, isConfigured, networkOrDefault } from '../deployments.ts';
import {
  centsToUnits,
  ensureFunded,
  explorer,
  formatUsdc,
  MIN_XLM,
  unitsToCents,
} from '../stellar.ts';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** Stubs fetch with a list of [matcher, response] and records what was called. */
function stubFetch(routes: [RegExp, { status: number; body?: unknown }][]) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new Error(`no stub for ${url}`);
    const [, res] = hit;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body ?? ''),
    } as Response;
  }) as typeof fetch;
  return calls;
}

const account = (xlm: string) => ({ balances: [{ asset_type: 'native', balance: xlm }] });
const G = 'GABC';

describe('ensureFunded', () => {
  it('asks friendbot only when the account does not exist', async () => {
    const calls = stubFetch([
      [/accounts/, { status: 404 }],
      [/friendbot/, { status: 200 }],
    ]);
    // Second horizon read, after friendbot: the stub above always 404s, so
    // swap in a fresh set once the first two calls have happened.
    let phase = 0;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (/friendbot/.test(url)) {
        phase = 1;
        return { ok: true, status: 200, text: async () => '' } as Response;
      }
      return phase === 0
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, status: 200, json: async () => account('10000.0000000') } as Response);
    }) as typeof fetch;

    const res = await ensureFunded(G);
    assert.equal(res.created, true);
    assert.equal(res.xlm, '10000.0000000');
    assert.ok(calls.some((c) => c.includes('friendbot')), 'never called friendbot');
  });

  it('does not re-fund an account that already has enough XLM', async () => {
    const calls = stubFetch([[/accounts/, { status: 200, body: account('42.0') }]]);
    const res = await ensureFunded(G);
    assert.deepEqual(res, { address: G, created: false, xlm: '42.0' });
    assert.ok(!calls.some((c) => c.includes('friendbot')), 'funded an account that had XLM');
  });

  // Regression. Pollar creates its wallets with a sponsored createAccount at a
  // "0" starting balance, so the account exists while holding nothing. Gating
  // on existence meant [Fondear] handed over 50 USDC and no XLM, and the
  // wallet could not pay the fee to spend any of it. Friendbot does top up an
  // account below its starting balance — it only refuses at or above it.
  it('RULE: an account that exists with no XLM still gets funded', async () => {
    let seen = 0;
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (/friendbot/.test(url)) return { ok: true, status: 200, text: async () => '' } as Response;
      seen += 1;
      return {
        ok: true,
        status: 200,
        json: async () => account(seen === 1 ? '0.0000000' : '10000.0000000'),
      } as Response;
    }) as typeof fetch;

    const res = await ensureFunded(G);
    assert.ok(calls.some((c) => c.includes('friendbot')), 'left a 0-XLM wallet unfunded');
    assert.equal(res.xlm, '10000.0000000');
    // The account was already there, so we did not create it — but we did fund it.
    assert.equal(res.created, false);
  });

  it('tops up an account sitting below MIN_XLM', async () => {
    let seen = 0;
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (/friendbot/.test(url)) return { ok: true, status: 200, text: async () => '' } as Response;
      seen += 1;
      return {
        ok: true,
        status: 200,
        json: async () => account(seen === 1 ? String(MIN_XLM - 1) : '10000.0'),
      } as Response;
    }) as typeof fetch;

    await ensureFunded(G);
    assert.ok(calls.some((c) => c.includes('friendbot')), 'left a near-empty wallet alone');
  });

  it('treats a friendbot refusal as success if the account exists anyway', async () => {
    // Two tabs, one wallet: our 404 read and someone else's funding raced.
    let seen = 0;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (/friendbot/.test(url)) {
        return { ok: false, status: 400, text: async () => 'op_already_exists' } as Response;
      }
      seen += 1;
      return seen === 1
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, status: 200, json: async () => account('10000.0') } as Response);
    }) as typeof fetch;

    const res = await ensureFunded(G);
    assert.equal(res.created, false);
    assert.equal(res.xlm, '10000.0');
  });

  it('throws when friendbot fails and the account is still not there', async () => {
    stubFetch([
      [/accounts/, { status: 404 }],
      [/friendbot/, { status: 503, body: 'down' }],
    ]);
    await assert.rejects(() => ensureFunded(G), /friendbot refused/);
  });
});

describe('USDC units', () => {
  it('converts cents to 7-decimal units without touching a float', () => {
    assert.equal(centsToUnits(100), 10_000_000n);
    assert.equal(centsToUnits(1), 100_000n);
    assert.equal(centsToUnits(1234), 123_400_000n);
    assert.equal(centsToUnits(0), 0n);
  });

  it('round-trips', () => {
    for (const c of [0, 1, 99, 100, 4567, 1_000_000]) {
      assert.equal(unitsToCents(centsToUnits(c)), c, `${c} cents did not survive`);
    }
  });

  it('refuses a fractional cent rather than silently truncating', () => {
    assert.throws(() => centsToUnits(10.5), /whole number/);
  });

  it('formats to two decimals, which is what a person reads', () => {
    assert.equal(formatUsdc(10_000_000n), '1.00');
    assert.equal(formatUsdc(123_400_000n), '12.34');
    assert.equal(formatUsdc(0n), '0.00');
    assert.equal(formatUsdc(50_000n), '0.00', 'half a cent rounds down, not up');
    assert.equal(formatUsdc(-123_400_000n), '-12.34');
  });
});

describe('deployments', () => {
  const testnet = DEPLOYMENTS.testnet;

  it('points at the contracts that were actually deployed', () => {
    assert.match(testnet.escrowId, /^C[A-Z0-9]{55}$/);
    assert.match(testnet.usdcId, /^C[A-Z0-9]{55}$/);
    assert.notEqual(testnet.escrowId, testnet.usdcId);
    assert.match(testnet.resolver, /^G[A-Z0-9]{55}$/);
    assert.match(testnet.treasury, /^G[A-Z0-9]{55}$/);
    assert.equal(testnet.networkPassphrase, 'Test SDF Network ; September 2015');
  });

  it('RULE: starts on testnet, and unknown values land there too', () => {
    // The whole app spends real-looking money. This is the line that says the
    // default is not real money. It replaces the old "never points at mainnet"
    // assertion, which stopped being true the day mainnet became reachable —
    // the risk moved from *having* a mainnet config to *defaulting* to one.
    assert.equal(DEFAULT_NETWORK, 'testnet');
    assert.equal(networkOrDefault(undefined), 'testnet');
    assert.equal(networkOrDefault('mainnet '), 'testnet', 'no fuzzy matching into real money');
    assert.equal(networkOrDefault('MAINNET'), 'testnet');
    assert.equal(networkOrDefault(''), 'testnet');
    assert.equal(asNetwork('nonsense'), null);
    assert.equal(asNetwork('mainnet'), 'mainnet', 'but an exact match is still honoured');
  });

  it('keeps each network pointing at its own chain', () => {
    assert.ok(testnet.rpcUrl.includes('testnet'));
    assert.ok(testnet.horizonUrl.includes('testnet'));
    assert.equal(explorer.tx('abc', 'testnet'), 'https://stellar.expert/explorer/testnet/tx/abc');
    // stellar.expert calls mainnet "public"; a link saying /mainnet/ 404s.
    assert.equal(explorer.tx('abc', 'mainnet'), 'https://stellar.expert/explorer/public/tx/abc');
    assert.equal(explorer.tx('abc'), explorer.tx('abc', DEFAULT_NETWORK));
  });

  it('RULE: no testnet value was pasted under the mainnet key', () => {
    // The new failure mode. Copying the block and forgetting to replace an id
    // would send real money to a contract that only exists on testnet.
    const main = DEPLOYMENTS.mainnet;
    assert.equal(main.networkPassphrase, 'Public Global Stellar Network ; September 2015');
    assert.notEqual(main.networkPassphrase, testnet.networkPassphrase);
    assert.ok(!main.rpcUrl.includes('testnet'));
    assert.ok(!main.horizonUrl.includes('testnet'));
    assert.equal(main.explorerPath, 'public');
    assert.equal(main.friendbotUrl, null, 'there is no free money on a public network');
    for (const key of ['escrowId', 'usdcId', 'resolver', 'treasury'] as const) {
      if (main[key]) assert.notEqual(main[key], testnet[key], `mainnet.${key} is the testnet value`);
    }
  });

  it('refuses to build a client for a network with no contracts', () => {
    assert.equal(isConfigured('testnet'), true);
    // Until the mainnet deploy happens this is false, and `deployment` must
    // say so in words rather than hand back an empty contract id.
    if (!isConfigured('mainnet')) {
      assert.throws(() => deployment('mainnet'), /No hay contratos desplegados en mainnet/);
    } else {
      assert.doesNotThrow(() => deployment('mainnet'));
    }
  });

  it('RULE: every network uses 7 decimals, which is why SCALE is module-level', () => {
    // formatUsdc/centsToUnits compute SCALE once at import. That is only safe
    // while every network agrees, so pin it rather than discover it.
    for (const net of NETWORK_IDS) {
      assert.equal(DEPLOYMENTS[net].usdcDecimals, 7, `${net} disagrees about decimals`);
    }
  });
});

describe('RULE: the bindings and deployments.json agree', () => {
  // The app no longer *reads* the bindings' `networks` export — the ids come
  // from lib/deployments.ts, which is what lets one bundle talk to two chains.
  // This stays as a provenance check: the bindings are generated from a
  // deployed contract's interface, so a baked id that has drifted from the
  // recorded one means the ABI in packages/ describes some other contract.
  // Read as text rather than imported: the generated bindings contain a real
  // TypeScript `enum`, which `node --experimental-strip-types` refuses. Next
  // compiles them with SWC and is perfectly happy; only this runner is not.
  const bakedId = async (pkg: string) => {
    const src = await readFile(new URL(`../../../../packages/${pkg}/src/index.ts`, import.meta.url), 'utf8');
    return src.match(/contractId: "(C[A-Z0-9]{55})"/)?.[1];
  };

  it('the escrow binding was generated from the deployed escrow', async () => {
    // They are written by the same script seconds apart, so a mismatch means
    // a deploy that half-finished, and the encoding in packages/ was taken
    // from a contract the app is not calling.
    assert.equal(await bakedId('escrow-bindings'), DEPLOYMENTS.testnet.escrowId);
  });

  it('the USDC binding was generated from the deployed token', async () => {
    assert.equal(await bakedId('usdc-bindings'), DEPLOYMENTS.testnet.usdcId);
  });
});
