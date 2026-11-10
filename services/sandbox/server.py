"""changuito's sandbox job API around agent.run_job.

    POST /jobs        {order_id, items: [{name, quantity, sku?}], shopper, card?}  -> {job_id}
    GET  /jobs/{id}   -> {job_id, status, phase, result?, error?}
    GET  /health      -> {ok, busy, queued}

Auth is `Authorization: Bearer $SANDBOX_TOKEN` on /jobs. The app (apps/web,
lib/checkout/sandbox.ts) starts a job after the shopper's USDC is locked in
the escrow, polls it, and settles or refunds on the result.

`shopper` is the shopper's Día login ({email, password, dni}) plus where to
deliver if their account has no saved address ({postcode, street, number,
phone, complement}), from their encrypted profile in the web app. `card` is
the card to pay with ({pan, cvv, exp_month, exp_year, holder, kind}), from the
web app's `shared_card` row; without it the run stops at the payment step.
Both live on the in-memory job until the run ends and are then deleted;
`GET /jobs/{id}` never returns them and nothing logs them. Nothing here reads a
login or a card from the environment. A manual session does not take a card on
the job: the shopper submits one later to the viewer, and that value is typed
into the merchant form and then discarded.

One job at a time, on purpose: one browser, one card, and a cart tied to a
session. Jobs live in memory. A restart loses them, and the app reads a 404
for a job it started as a failure and refunds — the safe direction.
"""

from __future__ import annotations

import asyncio
import hmac
import os
import time
import traceback
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pathlib import Path
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from agent import run_job
from manual import sessions, parent_origins

TOKEN = os.environ.get("SANDBOX_TOKEN", "")
MAX_ITEMS = 25
KEEP_S = 6 * 3600

jobs: dict[str, dict] = {}
queue: asyncio.Queue[str] = asyncio.Queue()
busy = False


class Item(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1, le=50)
    sku: str | None = None


class Shopper(BaseModel):
    # A 422 must not echo what was sent: for these two models that is a password or a card number.
    model_config = ConfigDict(hide_input_in_errors=True)

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128, repr=False)
    dni: str = Field(pattern=r"^\d{7,9}$")
    postcode: str | None = Field(default=None, max_length=12)
    street: str | None = Field(default=None, max_length=120)
    number: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=30)
    complement: str | None = Field(default=None, max_length=120)

    def __repr__(self) -> str:  # never print a shopper, even in a traceback
        return "Shopper(<redacted>)"

    __str__ = __repr__


class Card(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)

    pan: str = Field(pattern=r"^\d{13,19}$", repr=False)
    cvv: str = Field(pattern=r"^\d{3,4}$", repr=False)
    exp_month: str = Field(pattern=r"^(0?[1-9]|1[0-2])$", repr=False)
    exp_year: str = Field(pattern=r"^(\d{2}|\d{4})$", repr=False)
    holder: str = Field(min_length=1, max_length=80, repr=False)
    kind: Literal["debit", "credit"] = "debit"

    def __repr__(self) -> str:  # never print a card, even in a traceback
        return "Card(<redacted>)"

    __str__ = __repr__


class JobIn(BaseModel):
    # Errors in the nested shopper or card are raised from here, so the setting has to be here too.
    model_config = ConfigDict(hide_input_in_errors=True)

    order_id: str = Field(min_length=8, max_length=128)
    items: list[Item] = Field(min_length=1, max_length=MAX_ITEMS)
    shopper: Shopper
    card: Card | None = None
    mode: Literal['legacy', 'manual'] = 'legacy'
    buyer: str | None = Field(default=None, pattern=r'^[1-9A-HJ-NP-Za-km-z]{32,44}$')
    escrow_deadline: int | None = None
    flow: Literal['viewer', 'guided', 'headless'] = 'viewer'


_FIELD_CODE = {
    "dni": "invalid_shopper", "email": "invalid_shopper", "password": "invalid_shopper",
    "postcode": "invalid_shopper", "street": "invalid_shopper", "number": "invalid_shopper",
    "phone": "invalid_shopper", "complement": "invalid_shopper",
    "pan": "invalid_card", "cvv": "invalid_card", "exp_month": "invalid_card",
    "exp_year": "invalid_card", "holder": "invalid_card", "kind": "invalid_card",
    "name": "invalid_item", "quantity": "invalid_item", "sku": "invalid_item", "items": "invalid_item",
    "flow": "invalid_flow", "mode": "invalid_flow",
    "order_id": "invalid_order", "buyer": "invalid_order", "escrow_deadline": "invalid_order",
}


def rejection_reason(errors: list) -> tuple[str, str]:
    """A stable code and the field name. Never the submitted value."""
    for err in errors:
        parts = [str(part) for part in err.get("loc", ()) if part != "body" and not str(part).isdigit()]
        if parts:
            field = parts[-1]
            return _FIELD_CODE.get(field, "invalid_order"), field
    return "invalid_order", "body"


def auth(authorization: str = Header(default="")) -> None:
    if not TOKEN:
        raise HTTPException(503, "SANDBOX_TOKEN is not set")
    if not hmac.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "bad token")


def view(job: dict) -> dict:
    return {k: job.get(k) for k in ("job_id", "order_id", "status", "phase", "result", "error")}


async def worker() -> None:
    global busy
    while True:
        job_id = await queue.get()
        job = jobs.get(job_id)
        if not job:
            continue
        busy = True
        if job.get('mode') == 'manual':
            await manual_worker(job_id, job)
            busy = False
            continue
        job.update(status="running", phase="login", started=time.time())

        def on_phase(name: str) -> None:
            job["phase"] = name

        try:
            # Lines with a SKU go into the cart through VTEX's API at their quantity;
            # the rest are searched for by name.
            out = await run_job(job["items"], secrets=job.pop("shopper", None), card=job.pop("card", None),
                                on_phase=on_phase, job_id=job_id)
            job.update(status=out["status"], phase=out["phase"], result=out, error=out.get("error"))
        except Exception as e:  # noqa: BLE001 — a crashed run is a failed job, never a dead worker
            traceback.print_exc()
            job.update(status="failed", error=f"{type(e).__name__}: {e}"[:300])
        finally:
            job.pop("shopper", None)  # gone however the run ended
            job.pop("card", None)
            job["finished"] = time.time()
            busy = False
            for old in [k for k, v in jobs.items() if v.get("finished", time.time()) < time.time() - KEEP_S]:
                jobs.pop(old, None)


@asynccontextmanager
async def lifespan(_: FastAPI):
    sessions.start()
    task = asyncio.create_task(worker())
    outbox = asyncio.create_task(sessions.outbox())
    yield
    task.cancel()
    outbox.cancel()
    await asyncio.gather(task, outbox, return_exceptions=True)


app = FastAPI(title="changuito sandbox", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def rejected_job(_request: Request, exc: RequestValidationError) -> JSONResponse:
    code, field = rejection_reason(exc.errors())
    print(f"POST /jobs rejected {code} field={field}", flush=True)
    return JSONResponse(status_code=422, content={"detail": code})


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "busy": busy, "queued": queue.qsize(),
            'callback_ready': sessions.callback_ready, 'manual_ready': await sessions.available()}


@app.post("/jobs", dependencies=[Depends(auth)])
async def create(body: JobIn) -> dict:
    if body.mode == 'manual':
        if (body.card or not body.buyer or not body.shopper.postcode or not body.escrow_deadline
                or body.escrow_deadline < time.time() + 60 or not await sessions.available()):
            raise HTTPException(409, 'manual session unavailable')
        if not re.fullmatch(r'[0-9a-f]{64}', body.order_id):
            print("POST /jobs rejected invalid_order field=order_id", flush=True)
            raise HTTPException(422, 'invalid manual order')
        record, created = sessions.store.create(body.order_id, body.buyer)
        if created:
            jobs[record['job_id']] = {'mode': 'manual', 'items': [i.model_dump() for i in body.items],
                                      'escrow_deadline': body.escrow_deadline, 'flow': body.flow,
                                      'shopper': body.shopper.model_dump(exclude_none=True)}
            await queue.put(record['job_id'])
        stored = jobs.get(record['job_id'], {}).get('flow', body.flow)
        return {'job_id': record['job_id'], 'flow': stored if stored in ('viewer', 'guided', 'headless') else 'viewer'}
    # Idempotent per order: a retried start must not shop twice.
    for j in jobs.values():
        if j["order_id"] == body.order_id:
            return {"job_id": j["job_id"]}
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"job_id": job_id, "order_id": body.order_id, "status": "queued", "phase": "queued",
                    "items": [i.model_dump() for i in body.items], "created": time.time(),
                    "shopper": body.shopper.model_dump(exclude_none=True),
                    "card": body.card.model_dump() if body.card else None}
    await queue.put(job_id)
    return {"job_id": job_id}


@app.get("/jobs/{job_id}", dependencies=[Depends(auth)])
async def read(job_id: str) -> dict:
    if sessions.store and (record := sessions.store.get(job_id)):
        return sessions.store.event(record) | {'status': record['status']}
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return view(job)


async def manual_worker(job_id: str, job: dict):
    record = sessions.store.get(job_id)
    if record['status'] != 'queued':
        job.clear()
        return
    sessions.store.update(job_id, status='running', preparation='preparing')
    sessions.note_flow(job_id, job.get('flow'))

    def phase(name):
        sessions.store.update(job_id, phase=name)

    async def control(sb):
        await sessions.control(job_id, sb)

    task = asyncio.create_task(run_job(job['items'], secrets=job.pop('shopper'),
                                      on_phase=phase, on_manual=control, job_id=job_id))
    started = time.monotonic()
    try:
        while not task.done():
            r = sessions.store.get(job_id)
            if r['status'] == 'done' or (not r['preparedAt'] and (
                    time.monotonic() - started >= 600 or time.time() >= job['escrow_deadline'] - 60)):
                task.cancel()
                break
            await asyncio.sleep(1)
        await task
        r = sessions.store.get(job_id)
        if not r['preparedAt'] and r['preparation'] != 'cancelled':
            sessions.store.update(job_id, status='failed', preparation='failed', sessionActive=False)
    except asyncio.CancelledError:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        r = sessions.store.get(job_id)
        if r['status'] not in ('done', 'failed'):
            sessions.store.update(job_id, status='failed', preparation='interrupted', sessionActive=False)
        if asyncio.current_task().cancelling():
            raise
    except Exception:
        # User-entered payment values cannot be redacted reliably; never log raw exceptions.
        sessions.store.update(job_id, status='failed', preparation='failed', sessionActive=False)
    finally:
        job.clear()
        jobs.pop(job_id, None)


class TicketIn(BaseModel):
    purpose: Literal['card', 'browser', 'both'] = 'both'


@app.post('/jobs/{job_id}/ticket', dependencies=[Depends(auth)])
async def ticket(job_id: str, body: TicketIn = TicketIn()):
    if not sessions.store or sessions.active != job_id:
        raise HTTPException(409, 'session unavailable')
    try:
        # A card grant and a screen ticket are separate. Asking for the form
        # must not burn the single-use screen ticket.
        out = {}
        if body.purpose in ('browser', 'both'):
            out['ticket'] = sessions.store.ticket(job_id)
        if body.purpose in ('card', 'both'):
            out['cardToken'] = sessions.store.card_grant(job_id)
        return out
    except ValueError:
        raise HTTPException(409, 'session unavailable') from None


@app.post('/jobs/{job_id}/cancel', dependencies=[Depends(auth)])
async def cancel(job_id: str):
    if not sessions.store or not sessions.store.get(job_id):
        raise HTTPException(404, 'unknown manual job')
    r = sessions.store.cancel(job_id)
    await sessions.disconnect(job_id)
    return sessions.store.event(r)


class CancelOrder(BaseModel):
    buyer: str = Field(pattern=r'^[1-9A-HJ-NP-Za-km-z]{32,44}$')


@app.post('/orders/{order_id}/cancel', dependencies=[Depends(auth)])
async def cancel_order(order_id: str, body: CancelOrder):
    if not sessions.store or not re.fullmatch(r'[0-9a-f]{64}', order_id):
        raise HTTPException(409, 'manual service unavailable')
    try:
        record, _ = sessions.store.create(order_id, body.buyer)
    except ValueError:
        raise HTTPException(403, 'owner mismatch') from None
    return await cancel(record['job_id'])


@app.websocket('/viewer/{job_id}/socket')
async def viewer_socket(ws: WebSocket, job_id: str):
    await sessions.relay(ws, job_id)


@app.post('/viewer/{job_id}/card')
async def viewer_card(job_id: str, request: Request):
    """Shopper's browser only. The body is a card and is never logged or stored."""
    public = os.environ.get('SANDBOX_PUBLIC_URL', '').rstrip('/')
    if not public or request.headers.get('origin') != public:
        raise HTTPException(403, 'origin')
    if not re.fullmatch(r'[0-9a-f]{32}', job_id):
        raise HTTPException(404, 'unknown job')
    raw = await request.body()
    if len(raw) > 2048:
        raise HTTPException(413, 'too large')
    header = request.headers.get('authorization', '')
    token = header[7:] if header.startswith('Bearer ') else ''
    if not sessions.store or not token or not sessions.store.card_granted(token, job_id):
        raise HTTPException(401, 'unauthorized')
    try:
        card = Card.model_validate_json(raw)
    except Exception:
        raise HTTPException(422, 'invalid card') from None
    try:
        return await sessions.apply_card(job_id, card.model_dump())
    except PermissionError:
        raise HTTPException(409, 'session unavailable') from None
    except ValueError:
        raise HTTPException(422, 'invalid card') from None
    except Exception:
        raise HTTPException(502, 'card form unavailable') from None


@app.get('/viewer/')
async def viewer():
    body = (Path(__file__).parent / 'viewer' / 'index.html').read_text()
    body = body.replace('__PARENTS__', json.dumps(parent_origins()).replace('<', '\\u003c'))
    return HTMLResponse(body, headers={
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors " + ' '.join(parent_origins() or ["'none'"]),
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'})


@app.get('/viewer/viewer.js')
async def viewer_script():
    return FileResponse(Path(__file__).parent / 'viewer' / 'dist' / 'viewer.js', media_type='text/javascript')
