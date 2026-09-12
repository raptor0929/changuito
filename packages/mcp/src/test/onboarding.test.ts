import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { loadConfig } from '../config.js';
import {
  canPurchase,
  readiness,
  renderReadiness,
  SERVER_INSTRUCTIONS,
  setupGuidePath,
  setupRef,
} from '../onboarding.js';

const cfg = (env: Record<string, string> = {}) =>
  loadConfig({ SECRETS_DIR: '/tmp/x', ...env });

const steps = (env: Record<string, string> = {}, over = {}) =>
  readiness({ cfg: cfg(env), sessionExists: false, sessionPassphraseSet: false, ...over });

describe('setupGuidePath', () => {
  it('points at a file that actually exists', () => {
    // The whole reason this function exists is that "see SETUP.md" is useless
    // to someone who never cloned the repo. A path that does not resolve is
    // worse than no path at all.
    assert.ok(existsSync(setupGuidePath()), `${setupGuidePath()} does not exist`);
  });

  it('is absolute, because the user is not in our working directory', () => {
    assert.ok(setupGuidePath().startsWith('/'));
  });

  it('names the section so the pointer lands somewhere useful', () => {
    assert.match(setupRef('Crypto wallet'), /SETUP\.md — "Crypto wallet"\.$/);
  });
});

describe('readiness', () => {
  it('on a fresh install, nothing but the deliberate opt-outs is done', () => {
    const s = steps();
    assert.deepEqual(s.filter((x) => x.done).map((x) => x.n), []);
    assert.equal(canPurchase(s), false);
  });

  it('a purchase needs steps 1 and 2 only — not the wallet, not RPC', () => {
    const s = readiness({
      cfg: cfg({ VYRION_API_KEY: 'sk_test_abc' }),
      sessionExists: true,
      sessionPassphraseSet: true,
    });
    assert.equal(canPurchase(s), true, 'RPC_URL and ALLOW_LIVE must not block a purchase');
    assert.equal(s.find((x) => x.n === 3)!.done, false);
  });

  it('tells you to set the passphrase BEFORE telling you to link', () => {
    // Order matters: running link_marketplace_account without a passphrase
    // fails, and sending someone into a failure is not an instruction.
    const without = steps().find((x) => x.n === 1)!;
    assert.match(without.next!, /SESSION_PASSPHRASE/);

    const withIt = steps({}, { sessionPassphraseSet: true }).find((x) => x.n === 1)!;
    assert.match(withIt.next!, /link_marketplace_account/);
    assert.ok(!withIt.next!.includes('SESSION_PASSPHRASE'));
  });

  it('every incomplete step says what to do, and complete ones need not', () => {
    for (const s of steps()) {
      assert.ok(s.next && s.next.length > 20, `step ${s.n} has no actionable next`);
    }
  });

  it('frames live spending as a deliberate choice, not a missing setting', () => {
    const live = steps().find((x) => x.n === 4)!;
    assert.match(live.next!, /deliberately off/i);
  });
});

describe('renderReadiness', () => {
  it('leads with the single next step rather than a wall of settings', () => {
    const out = renderReadiness(steps());
    const next = out.indexOf('NEXT');
    assert.ok(next > 0);
    // Only the first incomplete step is promoted; the rest are not noise.
    assert.equal(out.split('NEXT').length - 1, 1);
  });

  it('always says search works anyway, because it does', () => {
    assert.match(renderReadiness(steps()), /search_products/);
  });

  it('says so plainly when nothing is left', () => {
    const done = steps().map((s) => ({ ...s, done: true }));
    const out = renderReadiness(done);
    assert.match(out, /Everything is configured/);
    assert.ok(!out.includes('NEXT'));
  });

  it('distinguishes "optional remaining" from "blocked"', () => {
    const ready = readiness({
      cfg: cfg({ VYRION_API_KEY: 'sk_test_abc' }),
      sessionExists: true,
      sessionPassphraseSet: true,
    });
    assert.match(renderReadiness(ready), /Nothing above blocks a purchase/);
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('states the ordered flow, which no tool description can', () => {
    for (const tool of [
      'link_marketplace_account',
      'set_delivery_address',
      'build_cart',
      'review_order',
      'check_funds',
      'approve_payment',
    ]) {
      assert.ok(SERVER_INSTRUCTIONS.includes(tool), `flow omits ${tool}`);
    }
  });

  it('carries the two rules that protect the user, in the model-facing slot', () => {
    // These are the only two places the model could cause real harm by being
    // helpful, so they belong where the model reads them, not only in a doc.
    assert.match(SERVER_INSTRUCTIONS, /[Nn]ever ask .*password/);
    assert.match(SERVER_INSTRUCTIONS, /[Nn]ever ask .*name or DNI/);
  });

  it('points a lost model at diagnose', () => {
    assert.match(SERVER_INSTRUCTIONS, /diagnose/);
  });

  it('stays short enough to send every session', () => {
    assert.ok(SERVER_INSTRUCTIONS.length < 2_000, `${SERVER_INSTRUCTIONS.length} chars is too long`);
  });
});

describe('RULE: the server tells the client how to use it', () => {
  it('index.ts declares instructions and a version matching package.json', async () => {
    const src = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
    assert.match(src, /instructions:\s*SERVER_INSTRUCTIONS/, 'the MCP instructions slot is empty');

    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.ok(
      src.includes(`version: '${pkg.version}'`),
      `index.ts reports a different version than package.json (${pkg.version})`,
    );
  });

  it('no error message points at a bare "SETUP.md" the user cannot find', async () => {
    const files = ['config.ts', 'tools.ts', 'pay/vyrion.ts', 'wallet/evm.ts', 'wallet/keystore.ts'];
    for (const f of files) {
      const src = await readFile(new URL(`../../src/${f}`, import.meta.url), 'utf8');
      for (const line of src.split('\n')) {
        if (/^\s*(\*|\/\/)/.test(line)) continue; // comments may say SETUP.md
        assert.ok(
          !/["'`][^"'`]*\bSETUP\.md\b/.test(line),
          `${f} hardcodes a bare SETUP.md in a message — use setupRef(): ${line.trim()}`,
        );
      }
    }
  });
});
