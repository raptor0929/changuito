"""Durable manual-session lifecycle. Never stores credentials or payment payloads."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

VIEWER_S = 900


class ManualStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self.db.execute("pragma journal_mode=WAL")
        self.db.executescript("""
          create table if not exists jobs (
            id text primary key, order_id text unique not null, buyer text not null,
            record text not null, delivered integer not null default 0);
          create table if not exists tickets (
            hash text primary key, job_id text not null, expires real not null);
          create table if not exists card_grants (
            hash text primary key, job_id text not null, expires real not null);
        """)

    def get(self, job_id: str) -> dict | None:
        row = self.db.execute("select record from jobs where id=?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def by_order(self, order_id: str) -> dict | None:
        row = self.db.execute("select record from jobs where order_id=?", (order_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def create(self, order_id: str, buyer: str) -> tuple[dict, bool]:
        if old := self.by_order(order_id):
            if old['buyer'] != buyer:
                raise ValueError('owner mismatch')
            return old, False
        job_id = uuid.uuid4().hex
        record = dict(job_id=job_id, order_id=order_id, buyer=buyer, status='queued', phase='queued',
                      preparation='queued', purchase='not_started', preparedAt=None,
                      viewerExpiresAt=None, sessionActive=False, sequence=1, store_order_id=None)
        with self.db:
            self.db.execute("insert into jobs(id,order_id,buyer,record) values(?,?,?,?)",
                            (job_id, order_id, buyer, json.dumps(record)))
        return record, True

    def update(self, job_id: str, **changes) -> dict:
        record = self.get(job_id)
        if not record:
            raise ValueError('unknown job')
        # Preparation is a durable fact, even after close/restart/payment failure.
        if record['preparedAt'] is not None:
            changes.pop('preparedAt', None)
            changes.pop('viewerExpiresAt', None)
            changes.pop('preparation', None)
        record.update(changes)
        record['sequence'] += 1
        with self.db:
            self.db.execute("update jobs set record=? where id=?", (json.dumps(record), job_id))
        return record

    def ready(self, job_id: str, now: int | None = None) -> dict:
        record = self.get(job_id)
        if not record or record['preparation'] != 'preparing':
            raise ValueError('job cannot become ready')
        now = now or int(time.time() * 1000)
        return self.update(job_id, preparation='ready', phase='payment', preparedAt=now,
                           viewerExpiresAt=now + VIEWER_S * 1000, sessionActive=True)

    def cancel(self, job_id: str) -> dict:
        record = self.get(job_id)
        if not record:
            raise ValueError('unknown job')
        if record['status'] in ('done', 'failed'):
            return record
        return self.update(job_id, status='done', preparation='cancelled', sessionActive=False,
                           purchase='unknown' if record['purchase'] == 'in_progress' else record['purchase'])

    def recover(self) -> None:
        for (job_id,) in self.db.execute("select id from jobs").fetchall():
            record = self.get(job_id)
            if record['status'] in ('queued', 'running'):
                self.update(job_id, status='failed', preparation='interrupted', sessionActive=False,
                            purchase='unknown' if record['preparedAt'] else 'not_started')
        with self.db:
            self.db.execute('delete from tickets')
            self.db.execute('delete from card_grants')

    def pending(self) -> list[dict]:
        return [r for (raw, delivered) in self.db.execute('select record,delivered from jobs')
                if (r := json.loads(raw))['sequence'] > delivered]

    def delivered(self, job_id: str, sequence: int) -> None:
        with self.db:
            self.db.execute('update jobs set delivered=max(delivered,?) where id=?', (sequence, job_id))

    def ticket(self, job_id: str) -> str:
        r = self.get(job_id)
        if not r or not r['sessionActive'] or r['viewerExpiresAt'] <= time.time() * 1000:
            raise ValueError('session unavailable')
        token = secrets.token_urlsafe(32)
        with self.db:
            self.db.execute('delete from tickets where job_id=? or expires<?', (job_id, time.time()))
            self.db.execute('insert into tickets values(?,?,?)',
                            (hashlib.sha256(token.encode()).hexdigest(), job_id, time.time() + 60))
        return token

    def consume(self, token: str, job_id: str) -> bool:
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.db:
            row = self.db.execute('delete from tickets where hash=? and job_id=? and expires>? returning hash',
                                  (digest, job_id, time.time())).fetchone()
        return bool(row)

    def card_grant(self, job_id: str) -> str:
        """Reusable until the session ends. Only the hash is stored."""
        record = self.get(job_id)
        if not record or not record['sessionActive'] or record['viewerExpiresAt'] <= time.time() * 1000:
            raise ValueError('session unavailable')
        token = secrets.token_urlsafe(32)
        with self.db:
            self.db.execute('delete from card_grants where job_id=? or expires<?', (job_id, time.time()))
            self.db.execute('insert into card_grants values(?,?,?)',
                            (hashlib.sha256(token.encode()).hexdigest(), job_id, record['viewerExpiresAt'] / 1000))
        return token

    def card_granted(self, token: str, job_id: str) -> bool:
        record = self.get(job_id)
        if not record or not record['sessionActive'] or record['viewerExpiresAt'] <= time.time() * 1000:
            return False
        digest = hashlib.sha256(token.encode()).hexdigest()
        row = self.db.execute('select 1 from card_grants where hash=? and job_id=? and expires>?',
                              (digest, job_id, time.time())).fetchone()
        return bool(row)

    @staticmethod
    def event(record: dict) -> dict:
        return {k: record[k] for k in ('order_id', 'job_id', 'phase', 'preparation', 'purchase',
                                      'preparedAt', 'viewerExpiresAt', 'sessionActive', 'sequence', 'store_order_id')}
