import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ArtifactRefused,
  duringPaymentWindow,
  inPaymentWindow,
  screenshot,
  startTrace,
  stopTrace,
} from '../checkout/browser.js';

/**
 * These tests guard the two rules the whole design rests on. They are
 * source-level on purpose: a rule that only holds when a particular code path
 * runs is a rule that will be broken by the next person who adds a code path.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

async function sourceFiles(sub: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  }
  await walk(join(SRC, sub));
  return out;
}

/** Strip comments so prose about a rule is not mistaken for breaking it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Comments, string literals AND regex literals removed, leaving only
 * identifiers and calls.
 *
 * Telling the user "your password was never seen" is the opposite of a
 * violation; a variable called `password` is the violation. Regexes are
 * stripped for the same reason: `hasField(ps, /contrase|password/i)` in the
 * modal registry DETECTS a login field to notice an expired session — noticing
 * one is how we bail out, and the line scan below still catches any attempt to
 * type into it.
 */
function identifiers(text: string): string {
  return code(text)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    // A regex literal: a slash not preceded by an operand, not opening a
    // comment, up to the closing slash and its flags.
    .replace(/(^|[=(,:[!&|?{};+\-*%~^]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuyd]*/g, '$1/RE/');
}

describe('RULE: this process never handles the marketplace password', () => {
  it('no identifier anywhere in the checkout layer is a password', async () => {
    const offenders: string[] = [];
    for (const f of await sourceFiles('checkout')) {
      const hit = identifiers(await readFile(f, 'utf8')).match(/password|passwd|contrase[nñ]a/i);
      if (hit) offenders.push(`${f}: ${hit[0]}`);
    }
    assert.deepEqual(offenders, [], 'the login is the user typing, in their own window');
  });

  it('no line anywhere types into a password-shaped field', async () => {
    // Catches the string-literal form the identifier scan cannot see:
    // page.fill('#password', ...) or getByLabel(/contraseña/i).fill(...)
    const offenders: string[] = [];
    for (const f of await sourceFiles('checkout')) {
      for (const line of code(await readFile(f, 'utf8')).split('\n')) {
        if (/password|passwd|contrase[nñ]a/i.test(line) && /\.(fill|type|press)\(/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('nothing types into a field, anywhere in the checkout layer, outside the payment form', async () => {
    // fill() is legitimate for the card form (dia.ts) and the address form, but
    // it must never appear in the login path.
    const auth = code(await readFile(join(SRC, 'checkout/auth.ts'), 'utf8'));
    for (const forbidden of ['.fill(', '.type(', '.press(', 'keyboard']) {
      assert.ok(!auth.includes(forbidden), `auth.ts must not call ${forbidden}`);
    }
  });

  it('auth.ts never captures an artifact of the login screen', async () => {
    const auth = code(await readFile(join(SRC, 'checkout/auth.ts'), 'utf8'));
    for (const forbidden of ['screenshot', 'tracing', 'recordVideo']) {
      assert.ok(!auth.includes(forbidden), `auth.ts must not call ${forbidden}`);
    }
  });
});

describe('RULE: no artifact capture while card data is on the page', () => {
  const fakePage = {
    screenshot: async () => assert.fail('must not reach Playwright'),
  } as never;
  const fakeContext = {
    tracing: {
      start: async () => assert.fail('must not reach Playwright'),
      stop: async () => assert.fail('must not reach Playwright'),
    },
  } as never;

  it('is closed by default and opens only inside the wrapper', async () => {
    assert.equal(inPaymentWindow(), false);
    await duringPaymentWindow(async () => {
      assert.equal(inPaymentWindow(), true);
    });
    assert.equal(inPaymentWindow(), false);
  });

  it('closes the window even when the payment throws', async () => {
    await assert.rejects(duringPaymentWindow(async () => { throw new Error('declined'); }));
    assert.equal(inPaymentWindow(), false);
  });

  it('counts nesting, so an inner window cannot re-open capture for the outer one', async () => {
    await duringPaymentWindow(async () => {
      await duringPaymentWindow(async () => {});
      assert.equal(inPaymentWindow(), true, 'still inside the outer payment window');
    });
    assert.equal(inPaymentWindow(), false);
  });

  it('refuses a screenshot before touching the browser', async () => {
    await duringPaymentWindow(async () => {
      await assert.rejects(screenshot(fakePage, '/tmp/nope', 'x'), ArtifactRefused);
    });
  });

  it('refuses to start or stop a trace', async () => {
    await duringPaymentWindow(async () => {
      await assert.rejects(startTrace(fakeContext), ArtifactRefused);
      await assert.rejects(stopTrace(fakeContext, '/tmp/t.zip'), ArtifactRefused);
    });
  });

  it('says plainly that it is not configurable', async () => {
    const e = new ArtifactRefused();
    assert.match(e.message, /not configurable/);
  });

  it('never enables video or HAR recording, in any context we create', async () => {
    const browser = code(await readFile(join(SRC, 'checkout/browser.ts'), 'utf8'));
    assert.ok(!/recordVideo:\s*\{/.test(browser));
    assert.ok(!/recordHar:\s*\{/.test(browser));
  });
});

describe('RULE: environment variables are read in exactly one place', () => {
  it('only config.ts and the standalone scripts touch process.env', async () => {
    const allowed = new Set(['config.ts', 'smoke.ts', 'dryrun.ts', 'record.ts']);
    const offenders: string[] = [];
    for (const sub of ['checkout', 'pay', 'wallet', 'secure', 'adapters', 'util']) {
      for (const f of await sourceFiles(sub)) {
        if (code(await readFile(f, 'utf8')).includes('process.env')) offenders.push(f);
      }
    }
    for (const name of await readdir(SRC)) {
      if (!name.endsWith('.ts') || allowed.has(name)) continue;
      if (code(await readFile(join(SRC, name), 'utf8')).includes('process.env')) {
        offenders.push(join(SRC, name));
      }
    }
    assert.deepEqual(offenders, [], 'route it through config.ts so it is validated once');
  });
});

describe('RULE: card data is typed only inside the payment window, and never logged', () => {
  const dia = () => readFile(join(SRC, 'checkout/dia.ts'), 'utf8');

  /** The body of a top-level function, up to the next top-level declaration. */
  function body(text: string, name: string): string {
    const start = text.indexOf(`export async function ${name}`);
    assert.notEqual(start, -1, `${name} is gone — this test needs updating, not deleting`);
    const rest = text.slice(start + 1);
    const end = rest.search(/\nexport (async )?(function|const|interface|class)/);
    return end === -1 ? rest : rest.slice(0, end);
  }

  it('fillCard runs inside duringPaymentWindow', async () => {
    assert.match(body(await dia(), 'fillCard'), /duringPaymentWindow/);
  });

  it('submitOtp runs inside duringPaymentWindow', async () => {
    assert.match(body(await dia(), 'submitOtp'), /duringPaymentWindow/);
  });

  it('no log line in the Día layer can carry a typed value', async () => {
    const offenders: string[] = [];
    for (const line of code(await dia()).split('\n')) {
      if (!/\blog\(/.test(line)) continue;
      // `spec.id` and `target.kind` are fine; the value itself never is.
      if (/\b(value|otp|pan|cvv|details|holder|document)\b/.test(line)) offenders.push(line.trim());
    }
    assert.deepEqual(offenders, [], 'log which field was filled, never what went into it');
  });

  it('the one function that types a value reports only the field id', async () => {
    const typeFn = (await dia()).match(/async function type\([\s\S]*?\n}/)?.[0] ?? '';
    assert.match(typeFn, /log\(`\[dia\] filled \$\{spec\.id\}`\)/);
    assert.equal(/log\([^)]*value/.test(typeFn), false);
  });

  it('the driver refuses to reach the card form without an approved card', async () => {
    const driver = code(await readFile(join(SRC, 'checkout/driver.ts'), 'utf8'));
    assert.match(driver, /if \(!src\) \{[\s\S]*?throw new Error/);
  });
});
