import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyRpcUrlBindings, readRpcUrl, rpcUrl, RPC_URL_VAR_NAMES } from '../rpc-url.ts';
import { DEPLOYMENTS } from '../deployments.ts';

const GATEWAY = 'https://soroban-rpc.testnet.stellar.gateway.fm';

describe('rpcUrl', () => {
  it('uses the recorded URL when the variable is unset', () => {
    assert.equal(rpcUrl('testnet', {}), DEPLOYMENTS.testnet.rpcUrl);
    assert.equal(rpcUrl('mainnet', {}), DEPLOYMENTS.mainnet.rpcUrl);
    assert.equal(DEPLOYMENTS.testnet.rpcUrl, GATEWAY);
  });

  it('lets a runtime https URL replace the recorded one', () => {
    const env = { STELLAR_RPC_URL: ' https://rpc.example.test/soroban/ ' };
    assert.equal(rpcUrl('testnet', env), 'https://rpc.example.test/soroban');
    assert.equal(rpcUrl('mainnet', { STELLAR_RPC_URL_MAINNET: 'https://main.example/' }), 'https://main.example');
  });

  it('ignores a URL that is not plain https', () => {
    assert.equal(readRpcUrl('http://rpc.example'), null);
    assert.equal(readRpcUrl('https://user:pw@rpc.example'), null);
    assert.equal(readRpcUrl('https://rpc.example/soroban?x=1'), null);
    assert.equal(readRpcUrl('not a url'), null);
    assert.equal(rpcUrl('testnet', { STELLAR_RPC_URL: 'http://rpc.example' }), DEPLOYMENTS.testnet.rpcUrl);
  });
});

describe('applyRpcUrlBindings', () => {
  it('copies a non-blank binding and leaves a blank one', () => {
    const env: { [key: string]: string | undefined } = { STELLAR_RPC_URL: 'https://kept.example' };
    applyRpcUrlBindings({ STELLAR_RPC_URL: '  https://rpc.example  ', STELLAR_RPC_URL_MAINNET: '   ' }, env);
    assert.equal(env.STELLAR_RPC_URL, 'https://rpc.example');
    assert.equal(env.STELLAR_RPC_URL_MAINNET, undefined);
    assert.deepEqual(RPC_URL_VAR_NAMES, ['STELLAR_RPC_URL', 'STELLAR_RPC_URL_MAINNET']);
  });
});
