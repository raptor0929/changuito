import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConfig } from '../config.js';
import {
  describeTransfer,
  normalizeRecipient,
  parseAmount,
  requireRpc,
  tokenAddress,
} from '../wallet/evm.js';

const cfg = (over: Record<string, string> = {}) =>
  loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/secrets-test', ...over });

const VYRION_DEPOSIT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('normalizeRecipient — a mistyped address is an irreversible loss', () => {
  it('checksums a lowercase address', () => {
    assert.equal(normalizeRecipient(VYRION_DEPOSIT.toLowerCase()), VYRION_DEPOSIT);
  });

  it('trims surrounding whitespace from a pasted address', () => {
    assert.equal(normalizeRecipient(`  ${VYRION_DEPOSIT}\n`), VYRION_DEPOSIT);
  });

  it('refuses a Stellar address — there is no XLM deposit path', () => {
    assert.throws(
      () => normalizeRecipient('GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX'),
      /not an EVM address/,
    );
  });

  it('refuses a truncated address, a bad checksum and an empty string', () => {
    assert.throws(() => normalizeRecipient('0x742d35Cc'), /not an EVM address/);
    assert.throws(() => normalizeRecipient('0x742d35cc6634c0532925a3b844bc454e4438f44E'), /not an EVM address/);
    assert.throws(() => normalizeRecipient(''), /not an EVM address/);
  });
});

describe('parseAmount', () => {
  it('reads human units at the token’s own precision', () => {
    assert.equal(parseAmount('20', 6), 20_000_000n, '20 USDT, not 20 wei');
    assert.equal(parseAmount('0.5', 18), 500_000_000_000_000_000n);
  });

  it('refuses zero and negative amounts', () => {
    assert.throws(() => parseAmount('0', 6), /greater than zero/);
    assert.throws(() => parseAmount('-1', 6), /greater than zero|underflow|invalid/i);
  });

  it('refuses junk rather than sending something unintended', () => {
    assert.throws(() => parseAmount('twenty', 6));
    assert.throws(() => parseAmount('20.1234567', 6), /decimal|underflow/i);
  });
});

describe('tokenAddress', () => {
  it('knows USDT on mainnet without configuration', () => {
    assert.equal(tokenAddress(cfg()), '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  });

  it('returns nothing for native ETH', () => {
    assert.equal(tokenAddress(cfg({ FUNDING_ASSET: 'eth' })), undefined);
  });

  it('uses an explicit override', () => {
    const addr = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    assert.equal(tokenAddress(cfg({ USDT_ADDRESS: addr })), addr);
  });

  it('says what to do on a chain it does not know', () => {
    assert.throws(() => tokenAddress(cfg({ CHAIN_ID: '31337' })), /Set USDT_ADDRESS/);
  });
});

describe('requireRpc', () => {
  it('explains that everything else still works without it', () => {
    assert.throws(() => requireRpc(cfg()), /Everything else works without it/);
  });

  it('returns the configured endpoint', () => {
    assert.equal(requireRpc(cfg({ RPC_URL: 'https://rpc.test/x' })), 'https://rpc.test/x');
  });
});

describe('describeTransfer — what the user restates before approving', () => {
  const view = {
    address: '0x0000000000000000000000000000000000000001',
    balance: '120.5',
    symbol: 'USDT',
    gasBalance: '0.02',
    canPayGas: true,
  };

  it('names both addresses, the amount and the gas', () => {
    const text = describeTransfer(view, VYRION_DEPOSIT, '20');
    assert.match(text, /120\.5 USDT/);
    assert.match(text, new RegExp(VYRION_DEPOSIT));
    assert.match(text, /Amount: 20 USDT/);
    assert.match(text, /0\.02 ETH/);
  });

  it('says plainly that it does not wait, and does not hold up an order', () => {
    const text = describeTransfer(view, VYRION_DEPOSIT, '20');
    assert.match(text, /not waited on/);
    assert.match(text, /does not hold up an order/);
  });
});
