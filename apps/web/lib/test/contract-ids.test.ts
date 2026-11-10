import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { applyContractIdBindings, contractIds, CONTRACT_ID_VAR_NAMES } from '../contract-ids.ts';
import { DEPLOYMENTS } from '../deployments.ts';

const CIRCLE_ESCROW = 'CDBGEMWESQJNEGBJ46TMPXNI5KFZN5B23W6ACO6NZFQATWWYY2WW3HDF';
const NAMES = CONTRACT_ID_VAR_NAMES;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    const previous = saved[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

describe('contractIds', () => {
  it('uses the recorded deploy when the Worker variables are unset', () => {
    for (const name of NAMES) delete process.env[name];
    assert.deepEqual(contractIds('testnet'), {
      escrowId: DEPLOYMENTS.testnet.escrowId,
      usdcId: DEPLOYMENTS.testnet.usdcId,
    });
  });

  it('lets a runtime variable replace the recorded contract', () => {
    process.env.STELLAR_ESCROW_ID = CIRCLE_ESCROW;
    const ids = contractIds('testnet');
    assert.equal(ids.escrowId, CIRCLE_ESCROW);
    assert.equal(ids.usdcId, DEPLOYMENTS.testnet.usdcId);
  });

  it('ignores a value that is not a contract id', () => {
    process.env.STELLAR_ESCROW_ID = 'not-a-contract';
    process.env.STELLAR_USDC_ID = '';
    assert.equal(contractIds('testnet').escrowId, DEPLOYMENTS.testnet.escrowId);
  });

  it('still refuses mainnet while that network has no recorded deploy', () => {
    process.env.STELLAR_ESCROW_ID_MAINNET = CIRCLE_ESCROW;
    assert.throws(() => contractIds('mainnet'), /No hay contratos desplegados en mainnet/);
  });
});

describe('applyContractIdBindings', () => {
  it('copies present bindings and leaves the others', () => {
    const env: { [key: string]: string | undefined } = { STELLAR_USDC_ID: 'keep' };
    applyContractIdBindings({ STELLAR_ESCROW_ID: `  ${CIRCLE_ESCROW}  `, STELLAR_USDC_ID: '   ' }, env);
    assert.equal(env.STELLAR_ESCROW_ID, CIRCLE_ESCROW);
    assert.equal(env.STELLAR_USDC_ID, 'keep');
  });
});

describe('the browser does not bake the contract id', () => {
  const source = readFileSync(join(import.meta.dirname, '../../components/PaymentModal.tsx'), 'utf8');

  it('asks the server which escrow to call', () => {
    assert.match(source, /\/api\/contracts\?network=/);
    assert.doesNotMatch(source, /deployment\(network\)\.escrowId/);
    assert.doesNotMatch(source, /process\.env\.STELLAR_ESCROW_ID/);
  });
});
