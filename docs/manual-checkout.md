# Embedded manual checkout

This optional, disabled-by-default mode prepares DIA's checkout, then exposes the
same authenticated browser through an interactive noVNC iframe.

## Product and fee policy

- Current shared-card members are eligible, but manual jobs never retrieve or
  receive the operator's card. The shopper enters their own payment details.
- Only **0.10 test USDC on devnet** is escrowed. DIA charges groceries and
  delivery separately in pesos; its final amount is reviewed in its checkout.
- The worker earns the fee when the complete basket, approved delivery and a
  fresh payment form are prepared and the viewer is available. The shopper does
  not need to open the viewer. Later abandonment, CAPTCHA rejection and payment
  failure do not refund the earned preparation fee. Failures before preparation
  refund it.
- The session expires 15 minutes after preparation, including reconnects.
- Fee status, preparation and merchant-purchase status remain separate. A settled
  fee never creates a paid shopping chat. A merchant-confirmed order is displayed
  as an order created; that does not claim bank approval.
- The future 20%-of-savings policy is deferred until comparison data exists.

## Contract and durable lifecycle

`open_service_fee(order_id, nonce, basket_hash, timeout_secs)` validates the order
ID against SHA-256 of `UTF8("changuito/service-fee/v1") || buyer public key (32
bytes) || nonce (32 bytes)`. It transfers exactly 100,000 base units of the
configured six-decimal mint. The order layout, order/vault seeds, legacy
instructions and resolver/buyer recovery rules remain compatible. The updated
IDL is versioned in `anchor/idl/changuito_escrow.json`.

Manual records live in the server-only, RLS-protected `manual_checkout` table;
legacy records remain in `kv`. SQLite on the worker's persistent volume holds
lifecycle facts, ticket hashes and an event outbox. No shopper credentials, card
data or browser profiles are persisted there. Prepared time is immutable across
restart/cancellation, and sequences reject stale events and stale request writes.

The always-running worker calls authenticated `/api/checkout/events`: `POST`
persists events and resolves the fee; unresolved events retry independently of
shopper polling. `GET` recovers funded orders that never reached `/start`, using
the regular authenticated jobs API. Shopper credentials travel only in the
server-to-server job request, not in the dispatch response or checkout record.

The server persists the co-signed transaction identity before broadcasting.
An interrupted confirmation request is recovered only after the on-chain order
matches the buyer, amount and basket. A lost browser response triggers status
reconciliation; a retry reuses the same signed transaction and order instead of
requesting another wallet approval. Unconfirmed attempts alone never start jobs.

An earned fee uses receipt basis `checkout-prepared/v1`. A worker restart loses
its Chromium process: pre-preparation jobs refund; prepared jobs keep the earned
fee and report the interrupted purchase as unknown. Unknown payment results
never trigger another purchase automatically.

## Viewer access

Chromium runs headed in Xvfb. x11vnc listens only on loopback port 5901, with
clipboard synchronization disabled. FastAPI exposes an authenticated binary
WebSocket relay through the existing service port; VNC/CDP ports are not public.
The root-owned Playwright driver launches Chromium through a privilege-dropping
wrapper as a separate Linux user, with a cleared environment. The job database
is mode 0600. The image configures `MANUAL_CHROMIUM_WRAPPER`; manual jobs fail
before preparation if that isolation is missing. Browser home/configuration live
inside the temporary profile; abandoned profiles of the dedicated browser user
are removed before the next serialized manual job.

`POST /api/checkout/viewer` checks wallet, ownership, membership and session
expiry, then returns a scoped, single-use ticket lasting 60 seconds. The parent
passes it using origin/source-checked `postMessage`; the socket uses a subprotocol
rather than putting a ticket in a URL. Reconnecting replaces the active controller.

The same response carries a card grant, valid until the session ends and stored
only as a hash. The viewer form posts the shopper's card to the worker, which
types it into the merchant form. The card is not written to the job database,
the event outbox, or the app. Submitting the form again replaces the card until
the merchant payment request has started; after that the form is refused. The
remote keyboard remains for verification challenges.

`POST /api/checkout/cancel` asks the worker to atomically decide whether the fee
was earned. Cancellation tombstones prevent a delayed start creating another
job. Closing a viewer does not cancel a merchant order already submitted.

Manual control disables model inspection, traces, recordings and payment-field
logging. The shopper completes native reCAPTCHA and bank verification. A
transaction-creation 403 means verification required, not a card decline.

## Rollout

Apply additive migration `0009_manual_checkout.sql`, which seeds
`manual_checkout_enabled=false`. Configure the Railway worker:

| Variable | Value/meaning |
| --- | --- |
| `SANDBOX_DATA_DIR` | `/data`, backed by a Railway persistent volume |
| `SANDBOX_PUBLIC_URL` | Exact worker HTTPS origin, without trailing slash |
| `VIEWER_PARENT_ORIGINS` | Exact allowed Changuito origins, comma-separated |
| `SANDBOX_CALLBACK_URL` | App URL ending `/api/checkout/events` |

Keep the existing `SANDBOX_TOKEN` equal on both services and server-only. Set
`SANDBOX_URL` during the web build, because it supplies the viewer CSP origin.
Retain one replica. The worker image bundles the viewer and starts Xvfb/VNC/API.

Deploy migration and worker with the flag off; review and approve the concrete
existing-program devnet upgrade, then deploy the compatible web application.
Verify `/health` reports `manual_ready: true` and `callback_ready: true`.
Manual readiness stays false while the authenticated callback is unavailable.
Before enabling, perform a
human-controlled DIA run covering login, exact basket/address, an empty card
form, native CAPTCHA, any bank redirects, mobile input and expiry. Additional
legitimate payment hosts may need allowlisting based on observed failures.

Enable with `npm run config -- set manual_checkout_enabled true`.
`sandbox_mock` retains precedence; nonmembers keep their existing demo flow.
Disabling the flag blocks new admissions, not already-funded work. Drain sessions
before maintenance: redeployment cannot preserve a running Chromium process.

This implementation does not itself apply production migrations, upgrade the
deployed program, enable the flag or submit a merchant payment.

## Local validation

```
npm test
npm run typecheck -w @changuito/web
npm run build
npm run build --prefix services/sandbox/viewer
cd anchor
NO_DNA=1 cargo test --locked
NO_DNA=1 cargo build-sbf --tools-version v1.56 --arch v3
NO_DNA=1 cargo test --test service_fee -- --include-ignored
cd ../services/sandbox
uv run python -m unittest discover -p test_manual.py -v
uv run python test_viewer_browser.py
```

The browser test needs Linux, Xvfb, x11vnc and Playwright Chromium. It uses only a
local merchant fixture and checks actual remote typing in the same browser,
cookie/postcode preservation, ticket replay rejection and cancellation disconnect.
`CHROMIUM_EXECUTABLE` can select an existing binary. It was validated in an
OrbStack Ubuntu machine without invoking the Docker client.

`manual-db.integration.ts` is an explicit test for a disposable local Postgres
database; it validates the real migration, RLS, stale events and stale writes.
It is outside the unit-test glob. Live merchant and Android/Seeker checks remain
rollout requirements; the local fixture does not establish those outcomes.
