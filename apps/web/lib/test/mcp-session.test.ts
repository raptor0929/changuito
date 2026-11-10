import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { SessionSnapshot } from '@changuito/mcp/session';
import type { LocationContext } from '@changuito/mcp/types';

import { resetSessions, snapshotKey, withSession } from '../mcp/session.ts';

const ID = '7d5e2c1a-0b7f-4c3e-9a51-2f6d8e4b9c10';

const dia: LocationContext = {
  retailer: 'dia',
  country: 'ARG',
  postalCode: '1425',
  sellers: [{ id: '1', name: 'Día' }],
  salesChannel: '1',
  degraded: false,
};

const jumbo: LocationContext = { ...dia, retailer: 'jumbo', postalCode: '1414' };

afterEach(async () => {
  await resetSessions();
});

test('a warm session takes the location another instance gave the browser', async () => {
  // Turn 1 on this instance: the early question, no location yet.
  const first = await withSession(ID, undefined, async () => {});
  assert.equal(first.snapshot.location, undefined);

  // Turn 2 ran elsewhere and set Día 1425. The browser sends that back here.
  const fromElsewhere: SessionSnapshot = { location: dia, carts: { dia: 'of-1' } };
  const { result } = await withSession(ID, fromElsewhere, async (s) => s.state.getLocation());

  assert.equal(result?.retailer, 'dia');
  assert.equal(result?.postalCode, '1425');
});

test('the snapshot this instance issued does not undo a turn that threw', async () => {
  const issued = (await withSession(ID, undefined, async (s) => s.state.setLocation(dia))).snapshot;

  // This turn changed the store and then failed, so no `done` reached the browser.
  await assert.rejects(
    withSession(ID, issued, async (s) => {
      s.state.setLocation(jumbo);
      throw new Error('hop failed');
    }),
  );

  // The browser resends the snapshot it has, which is the one issued before.
  const roundTripped = JSON.parse(JSON.stringify(issued)) as SessionSnapshot;
  const { result } = await withSession(ID, roundTripped, async (s) => s.state.getLocation());
  assert.equal(result?.retailer, 'jumbo');
});

test('a snapshot rebuilt from localStorage in another key order is the same snapshot', () => {
  const issued: SessionSnapshot = { location: dia, carts: { dia: 'of-1' } };
  const repacked: SessionSnapshot = {
    carts: { dia: 'of-1' },
    location: {
      retailer: 'dia',
      country: 'ARG',
      postalCode: '1425',
      sellers: [{ id: '1', name: 'Día' }],
      salesChannel: '1',
      degraded: false,
      regionId: undefined,
    },
  };
  assert.equal(snapshotKey(repacked), snapshotKey(issued));
});
