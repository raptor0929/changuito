import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { envFlag } from '../env-flag.ts';

const env = (value?: string) => ({ ...(value === undefined ? {} : { FLAG: value }) }) as NodeJS.ProcessEnv;

describe('env flags', () => {
  it('is off unless somebody said a yes-word', () => {
    for (const off of [undefined, '', '   ', 'false', '0', 'no', 'off', 'disabled', 'null', 'undefined', 'y', 'tru']) {
      assert.equal(envFlag('FLAG', env(off)), false, `"${off ?? '<unset>'}" should be off`);
    }
  });

  it('RULE: the string "false" is not true', () => {
    // Boolean(env.X) and `X !== undefined` both say yes to this, and a
    // dashboard with no checkbox is exactly where somebody types it to mean
    // no. Every flag in this repo opens a door that is otherwise shut, so
    // this is the direction the mistake must not go.
    assert.equal(envFlag('FLAG', env('false')), false);
    assert.equal(envFlag('FLAG', env('0')), false);
  });

  it('takes the yes-words, in any case, with whitespace around them', () => {
    for (const on of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', ' true ', '\ttrue\n']) {
      assert.equal(envFlag('FLAG', env(on)), true, `"${on}" should be on`);
    }
  });

  it('reads the name it was given and nothing else', () => {
    assert.equal(envFlag('OTHER', env('true')), false);
  });
});
