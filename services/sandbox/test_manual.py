import asyncio
import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from manual_store import ManualStore


class ManualLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'jobs.sqlite3')
        self.store = ManualStore(self.path)
        self.job, _ = self.store.create('a' * 64, 'buyer')
        self.id = self.job['job_id']

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def ready(self):
        self.store.update(self.id, status='running', preparation='preparing')
        return self.store.ready(self.id)

    def test_idempotent_start_and_owner(self):
        again, created = self.store.create('a' * 64, 'buyer')
        self.assertFalse(created)
        self.assertEqual(again['job_id'], self.id)
        with self.assertRaises(ValueError):
            self.store.create('a' * 64, 'other buyer')

    def test_ready_requires_preparation_and_sets_fixed_deadline(self):
        with self.assertRaises(ValueError):
            self.store.ready(self.id)
        ready = self.ready()
        self.assertEqual(ready['viewerExpiresAt'] - ready['preparedAt'], 900_000)

    def test_cancellation_before_ready_is_durable_tombstone(self):
        cancelled = self.store.cancel(self.id)
        self.assertIsNone(cancelled['preparedAt'])
        self.assertEqual(cancelled['preparation'], 'cancelled')
        self.assertFalse(self.store.create('a' * 64, 'buyer')[1])
        with self.assertRaises(ValueError):
            self.store.ready(self.id)

    def test_after_ready_abandonment_and_decline_keep_earned_fee(self):
        ready = self.ready()
        self.store.update(self.id, purchase='declined')
        stopped = self.store.cancel(self.id)
        self.assertEqual(stopped['preparedAt'], ready['preparedAt'])
        self.assertEqual(stopped['preparation'], 'ready')
        self.assertEqual(stopped['purchase'], 'declined')
        self.assertFalse(stopped['sessionActive'])

    def test_restart_preserves_preparation_and_marks_purchase_unknown(self):
        before = self.ready()
        other = ManualStore(self.path)
        other.recover()
        after = other.get(self.id)
        self.assertEqual(after['preparedAt'], before['preparedAt'])
        self.assertEqual(after['purchase'], 'unknown')
        self.assertFalse(after['sessionActive'])
        other.db.close()

    def test_restart_before_ready_reports_interrupted_without_fee_earned(self):
        self.store.recover()
        r = self.store.get(self.id)
        self.assertEqual(r['preparation'], 'interrupted')
        self.assertIsNone(r['preparedAt'])

    def test_tickets_are_hashed_single_use_and_scoped(self):
        self.ready()
        token = self.store.ticket(self.id)
        raw = self.store.db.execute('select hash from tickets').fetchone()[0]
        self.assertNotEqual(raw, token)
        self.assertEqual(raw, hashlib.sha256(token.encode()).hexdigest())
        self.assertFalse(self.store.consume(token, 'another job'))
        self.assertTrue(self.store.consume(token, self.id))
        self.assertFalse(self.store.consume(token, self.id))

    def test_ticket_expiration_and_replacement(self):
        self.ready()
        old = self.store.ticket(self.id)
        new = self.store.ticket(self.id)
        self.assertFalse(self.store.consume(old, self.id))
        with patch('manual_store.time.time', return_value=time.time() + 61):
            self.assertFalse(self.store.consume(new, self.id))

    def test_session_expiry_prevents_new_tickets(self):
        ready = self.ready()
        with patch('manual_store.time.time', return_value=ready['viewerExpiresAt'] / 1000 + 1):
            with self.assertRaises(ValueError):
                self.store.ticket(self.id)

    def test_outbox_ack_cannot_drop_later_event(self):
        seq = self.store.get(self.id)['sequence']
        self.store.update(self.id, preparation='preparing')
        self.store.delivered(self.id, seq)
        self.assertEqual(len(self.store.pending()), 1)
        self.store.delivered(self.id, self.store.get(self.id)['sequence'])
        self.assertEqual(self.store.pending(), [])

    def test_public_event_cannot_include_credentials(self):
        event = self.store.event(self.store.get(self.id))
        self.assertNotIn('buyer', event)
        self.assertNotIn('password', json.dumps(event))
        self.assertNotIn('card', json.dumps(event))

    def test_database_is_private_to_the_worker(self):
        self.assertEqual(Path(self.path).stat().st_mode & 0o777, 0o600)

    def test_card_grant_is_hashed_reusable_and_replaced(self):
        self.ready()
        token = self.store.card_grant(self.id)
        raw = self.store.db.execute('select hash from card_grants').fetchone()[0]
        self.assertNotEqual(raw, token)
        self.assertEqual(raw, hashlib.sha256(token.encode()).hexdigest())
        self.assertTrue(self.store.card_granted(token, self.id))
        self.assertTrue(self.store.card_granted(token, self.id))
        self.assertFalse(self.store.card_granted(token, 'b' * 32))
        nxt = self.store.card_grant(self.id)
        self.assertFalse(self.store.card_granted(token, self.id))
        self.assertTrue(self.store.card_granted(nxt, self.id))
        event = json.dumps(self.store.event(self.store.get(self.id)))
        self.assertNotIn(token, event)
        self.assertNotIn(nxt, event)

    def test_card_grant_expires_with_the_session(self):
        ready = self.ready()
        token = self.store.card_grant(self.id)
        with patch('manual_store.time.time', return_value=ready['viewerExpiresAt'] / 1000 + 1):
            self.assertFalse(self.store.card_granted(token, self.id))
            with self.assertRaises(ValueError):
                self.store.card_grant(self.id)

    def test_restart_drops_card_grants(self):
        self.ready()
        self.store.card_grant(self.id)
        other = ManualStore(self.path)
        other.recover()
        self.assertEqual(other.db.execute('select count(*) from card_grants').fetchone()[0], 0)
        other.db.close()


class ManualCardBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_shutdown_does_not_swallow_cancellation(self):
        import server
        with tempfile.TemporaryDirectory() as directory:
            store = ManualStore(str(Path(directory) / 'jobs.sqlite3'))
            job, _ = store.create('c' * 64, 'fixture')
            async def blocked(*args, **kwargs):
                await asyncio.Event().wait()
            with patch.object(server.sessions, 'store', store), patch.object(server, 'run_job', blocked):
                task = asyncio.create_task(server.manual_worker(job['job_id'],
                    {'items': [], 'shopper': {}, 'escrow_deadline': int(time.time()) + 3600}))
                await asyncio.sleep(.02)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(task, .5)
                self.assertEqual(store.get(job['job_id'])['preparation'], 'interrupted')
            store.db.close()

    async def test_manual_jobs_reject_a_card_before_launching_browser(self):
        from agent import run_job
        with self.assertRaises(ValueError):
            await run_job([], card={'pan': 'fixture-only'}, on_manual=lambda _: None)

    async def test_manual_jobs_cannot_enable_recordings(self):
        from agent import run_job
        with self.assertRaises(ValueError):
            await run_job([], record=True, on_manual=lambda _: None)

    async def test_card_apply_without_a_browser_is_refused(self):
        from manual import ManualSessions
        with tempfile.TemporaryDirectory() as directory:
            store = ManualStore(str(Path(directory) / 'jobs.sqlite3'))
            job, _ = store.create('d' * 64, 'fixture')
            store.update(job['job_id'], status='running', preparation='preparing')
            store.ready(job['job_id'])
            sessions = ManualSessions()
            sessions.store = store
            sessions.active = job['job_id']
            with self.assertRaises(PermissionError):
                await sessions.apply_card(job['job_id'], {})
            store.db.close()


class UnattendedPaymentTests(unittest.TestCase):
    def test_only_a_complete_headless_card_pays_and_a_challenge_does_not_place(self):
        from manual import ManualSessions, blocks_unattended_purchase, should_pay_unattended
        sessions = ManualSessions()
        sessions.note_flow('job', 'nope')
        self.assertEqual(sessions.flows['job'], 'viewer')
        sessions.note_flow('job', 'headless')
        self.assertFalse(should_pay_unattended('viewer', []))
        self.assertFalse(should_pay_unattended('guided', []))
        self.assertFalse(should_pay_unattended('headless', ['pan']))
        self.assertTrue(should_pay_unattended(sessions.flows['job'], []))
        self.assertTrue(blocks_unattended_purchase(True, False))
        self.assertTrue(blocks_unattended_purchase(False, True))
        self.assertFalse(blocks_unattended_purchase(False, False))


class CartPayAgainTests(unittest.TestCase):
    """Cart, pay, abandon and pay again. The store is sqlite. No browser and no merchant."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'jobs.sqlite3')
        self.store = ManualStore(self.path)
        self.order = 'a' * 64
        self.job, _ = self.store.create(self.order, 'buyer')
        self.id = self.job['job_id']

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def ready(self, job_id=None):
        job_id = job_id or self.id
        self.store.update(job_id, status='running', preparation='preparing')
        return self.store.ready(job_id)

    def test_available_lines_stay_in_the_cart_and_the_record_has_no_secrets(self):
        from checkout import landed_lines
        lines = [
            {'sku': '111', 'name': 'Yerba', 'quantity': 1},
            {'sku': '222', 'name': 'Azucar', 'quantity': 2},
            {'name': 'Sin sku', 'quantity': 1},
        ]
        items = [
            {'id': '111', 'availability': 'available'},
            {'id': '222', 'availability': 'withoutStock'},
        ]
        added, rest = landed_lines(lines, items)
        self.assertEqual(added, ['Yerba'])
        self.assertEqual([line['name'] for line in rest], ['Azucar', 'Sin sku'])
        ready = self.ready()
        self.assertEqual(ready['purchase'], 'not_started')
        blob = json.dumps(self.store.get(self.id))
        for secret in ('card-number', '999', 'shopper-password', 'pan', 'cvv', 'password'):
            self.assertNotIn(secret, blob)

    def test_paying_is_not_placed_until_the_store_returns_an_order(self):
        from checkout import normalize_card
        from manual import purchase_with_store_order, should_pay_unattended
        self.ready()
        paying = self.store.update(self.id, purchase='in_progress')
        self.assertEqual(paying['purchase'], 'in_progress')
        self.assertIsNone(paying['store_order_id'])
        self.assertEqual(purchase_with_store_order('in_progress', None), 'in_progress')
        self.assertEqual(purchase_with_store_order('placed', None), 'in_progress')
        placed = purchase_with_store_order('in_progress', 'store-order-1')
        saved = self.store.update(self.id, purchase=placed, store_order_id='store-order-1')
        self.assertEqual(saved['purchase'], 'placed')
        self.assertEqual(saved['store_order_id'], 'store-order-1')
        self.assertIsNone(normalize_card({'pan': '0000', 'cvv': ''}))
        self.assertFalse(should_pay_unattended('headless', ['cvv']))

    def test_closing_abandons_an_unsent_payment_and_leaves_a_sent_one_unknown(self):
        from manual import closed_purchase
        ready = self.ready()
        token = self.store.card_grant(self.id)
        closed = self.store.update(
            self.id, status='done', sessionActive=False, purchase=closed_purchase('not_started'))
        self.assertEqual(closed['purchase'], 'abandoned')
        self.assertFalse(closed['sessionActive'])
        self.assertEqual(closed['preparedAt'], ready['preparedAt'])
        self.store.update(self.id, preparedAt=None)
        self.assertEqual(self.store.get(self.id)['preparedAt'], ready['preparedAt'])
        self.assertFalse(self.store.card_granted(token, self.id))

        other, created = self.store.create('b' * 64, 'buyer')
        self.assertTrue(created)
        self.ready(other['job_id'])
        self.store.update(other['job_id'], purchase='in_progress')
        sent = self.store.update(
            other['job_id'], status='done', sessionActive=False,
            purchase=closed_purchase('in_progress'))
        self.assertEqual(sent['purchase'], 'unknown')
        self.assertNotEqual(sent['purchase'], 'placed')
        self.assertIsNotNone(sent['preparedAt'])

    def test_the_same_order_does_not_open_twice_and_a_new_one_can_be_prepared(self):
        from manual import closed_purchase
        self.ready()
        self.store.update(
            self.id, status='done', sessionActive=False, purchase=closed_purchase('not_started'))
        again, created = self.store.create(self.order, 'buyer')
        self.assertFalse(created)
        self.assertEqual(again['job_id'], self.id)
        self.assertEqual(again['purchase'], 'abandoned')
        self.assertNotEqual(again['status'], 'queued')
        with self.assertRaises(ValueError):
            self.store.ready(self.id)
        fresh, created = self.store.create('c' * 64, 'buyer')
        self.assertTrue(created)
        self.assertEqual(fresh['purchase'], 'not_started')
        prepared = self.ready(fresh['job_id'])
        self.assertEqual(prepared['purchase'], 'not_started')
        self.assertIsNotNone(prepared['preparedAt'])
        self.assertEqual(self.store.get(self.id)['purchase'], 'abandoned')
        self.assertIsNone(self.store.get(self.id)['store_order_id'])


if __name__ == '__main__':
    unittest.main()
