import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { STARTERS } from '../agent/prompt.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the price starter asks for leche con proteína and the chip is the message', () => {
  assert.deepEqual(STARTERS, [
    'Armá un desayuno para dos por menos de $10.000',
    'Compará precios de leche con proteína',
    'Carrito básico para la semana: arroz, fideos, aceite y huevos',
  ]);
  for (const line of STARTERS) {
    assert.equal(line.includes('\u2014'), false);
    assert.equal(line.includes('\u2013'), false);
  }
  assert.equal(STARTERS.some((line) => line.includes('descremada')), false);

  const chat = readFileSync(join(root, 'components/Chat.tsx'), 'utf8');
  assert.equal(chat.includes('onPick={submit}'), true);
  assert.equal(chat.includes('onClick={() => onPick(s)}'), true);
  assert.equal(chat.includes('{s}'), true);
});
