/** Run explicitly against a disposable local Postgres database (not part of the unit glob). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { resetDb } from '../db.ts';
import { checkoutStore, type CheckoutRecord } from '../checkout/store.ts';
import { recordManualEvent } from '../checkout/manual-server.ts';
import type { ManualEvent } from '../checkout/manual-policy.ts';

if (process.env.MANUAL_DB_FIXTURE !== 'local-only') throw new Error('explicit local fixture required');
const sql = postgres({ host: '/var/run/postgresql', database: 'manual_fixture', user: 'postgres', max: 1, prepare: false });
process.env.DATABASE_URL = 'local-fixture';
resetDb(sql);
const schema = `manual_test_${Date.now()}`;
try {
  await sql`create schema ${sql(schema)}`;
  await sql`set search_path to ${sql(schema)}`;
  await sql`create table config(key text primary key, value jsonb not null)`;
  await sql`create table kv(key text primary key, value jsonb not null, expires_at timestamptz not null)`;
  const migration = await readFile(new URL('../../../../supabase/migrations/0009_manual_checkout.sql', import.meta.url), 'utf8');
  await sql.unsafe(migration);
  assert.equal((await sql`select value from config where key='manual_checkout_enabled'`)[0].value, false);
  const rec: CheckoutRecord = {
    orderId: 'ab'.repeat(32), checkoutKind: 'manual_fee_v1', orderNonce: 'cd'.repeat(32), buyer: 'fixture-buyer',
    amount: '100000', amountCents: 10, basketHash: 'ef'.repeat(32), arsPerUsd: 1500,
    totalDisplay: '$10', retailer: 'dia', lines: [], handoffUrl: null, createdAt: Date.now(), mode: 'live',
    manual: { preparation: 'queued', purchase: 'not_started', preparedAt: null, viewerExpiresAt: null, sessionActive: false, sequence: 0 },
  };
  const store = checkoutStore();
  await store.set(rec);
  const queued: ManualEvent = { ...rec.manual!, sequence: 1, job_id: 'a'.repeat(32), order_id: rec.orderId, phase: 'queued', store_order_id: null };
  await recordManualEvent(queued);
  const prepared: ManualEvent = { ...queued, sequence: 3, preparation: 'ready', preparedAt: 1000,
    viewerExpiresAt: 901000, sessionActive: true, phase: 'payment' };
  await recordManualEvent(prepared);
  // A stale start completion cannot overwrite a newer worker event.
  await store.set({ ...rec, jobId: queued.job_id, openSig: 'fixture-signature' });
  let saved = await store.get(rec.orderId);
  assert.equal(saved?.manual?.preparedAt, 1000);
  assert.equal(saved?.openSig, 'fixture-signature');
  await recordManualEvent({ ...queued, sequence: 2, preparation: 'failed' });
  assert.equal((await store.get(rec.orderId))?.manual?.preparation, 'ready');
  await recordManualEvent({ ...prepared, sequence: 4, preparedAt: 2000, viewerExpiresAt: 902000 });
  assert.equal((await store.get(rec.orderId))?.manual?.preparedAt, 1000);
  await recordManualEvent({ ...prepared, sequence: 5, sessionActive: false, purchase: 'unknown' });
  saved = await store.get(rec.orderId);
  assert.equal(saved?.manual?.purchase, 'unknown');
  assert.equal(saved?.manual?.preparedAt, 1000);
  const guards = await sql`select relrowsecurity from pg_class where oid='manual_checkout'::regclass`;
  assert.equal(guards[0].relrowsecurity, true);
  console.log('PASS: migration defaults/RLS, durable order, stale-event rejection, immutable preparation and stale-write protection');
} finally {
  await sql`drop schema ${sql(schema)} cascade`;
  await sql.end();
}
