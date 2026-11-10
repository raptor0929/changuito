import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { SessionSnapshot } from '@changuito/mcp/session';
import type { LocationContext } from '@changuito/mcp/types';

import { resetSessions, withSession } from '../mcp/session.ts';

const ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

const dia: LocationContext = {
  retailer: 'dia',
  country: 'ARG',
  postalCode: '1425',
  sellers: [{ id: '1', name: 'Día' }],
  salesChannel: '1',
  degraded: false,
};

afterEach(async () => {
  await resetSessions();
});

test('a snapshot with no location does not wipe a postal code already set', async () => {
  await withSession(ID, undefined, async (s) => s.state.setLocation(dia));

  const stale: SessionSnapshot = { carts: {} };
  const { result } = await withSession(ID, stale, async (s) => s.state.getLocation());

  assert.equal(result?.retailer, 'dia');
  assert.equal(result?.postalCode, '1425');
});
