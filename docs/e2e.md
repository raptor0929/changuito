# End-to-end smoke

Playwright checks the live sites. Unit tests stay on `npm test` and do not
open a browser.

| Surface | URL |
|---|---|
| Landing | `LANDING_BASE_URL`, default `https://www.changuito.me` |
| Shopper | `APP_BASE_URL`, default `https://app.changuito.me` |

Production is the target on purpose. A local preview needs Pollar, Turnstile,
and the model keys the app already has on Vercel. CI does not have those, and
a preview would not be what visitors hit. The workflow does not build or
start Next.

The smoke does not pay, does not open a store checkout, and does not click
**Cargar USDC**.

## Run locally

Node is `22.12.0` (`.nvmrc`). From the repo root, after `npm ci`:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:e2e:ui
```

`test:e2e:ui` opens Playwright's runner. Optional overrides live in
`e2e/.env` (copy `e2e/.env.example`). Values already exported in the shell
win over that file.

## What the specs assert

- **Landing.** The home page renders, the three nav anchors (`#como-funciona`,
  `#pagos`, `#faq`) scroll into view, **Probar Changuito** goes to
  `/whitelist`, and one FAQ item expands.
- **Whitelist.** An empty submit shows the name and email errors. A name plus
  `no-es-un-email` shows `Revisá tu email.` The test does not submit a real
  signup.
- **App, guest.** The masthead and **Empezá a comprar** render, and the page
  throws no uncaught error. **Empezá a comprar** opens the Pollar modal
  (`Log in or sign up`, email, Submit, Google, Wallet) and there is no
  password field. The spec closes the modal and does not submit. Chat is
  behind Turnstile. If the check passes, the spec clicks the
  leche-con-proteína chip (or types a short prompt) and stops. If Turnstile
  stays up, the verification screen is the pass: CI must not depend on
  Cloudflare letting a bot through. A headless run on 2026-09-24 stayed on
  that screen. Product search is not asserted. Guests currently fail that
  search (issue [#51](https://github.com/raptor0929/changuito/issues/51)),
  and a search can take a minute.
- **App, auth.** Skipped unless both `CHANGUTO_E2E_EMAIL` and
  `CHANGUTO_E2E_PASSWORD` are non-empty. It opens **Empezá a comprar** and
  uses the email field. Traces and screenshots are off for this spec so a
  public Actions artifact cannot keep the inbox or the code.

## Pollar has no password field

`@pollar/react` 0.11.3 (what the shopper mounts) signs in with email by
sending a **6-digit code**, then Google or a wallet. The modal copy is
`Log in or sign up`, `Submit`, and `or continue with`. There is no password
input.

So:

| Secrets | What the auth spec does |
|---|---|
| Either missing or blank | Skips |
| Email + any password, no 6-digit code | Submits the email, expects the code screen, does not claim the wallet chrome |
| Email + `CHANGUTO_E2E_OTP` (or a password that is exactly 6 digits) | Types the code and expects **Salir**, **Tu pago**, and **Cargar USDC** |

A normal password cannot finish login. A code is one-time, so a standing
GitHub secret will not keep the signed-in assertion green unless Pollar
issues a fixed test code. Google OAuth is intentionally not automated.

If the modal has no email field, the spec skips and records that the widget
was Google or wallet only.

## GitHub Actions

`.github/workflows/e2e.yml` runs on pull requests, pushes to `main`,
`workflow_dispatch`, and Mondays at 12:00 UTC.

The job installs Node from `.nvmrc`, runs `npm ci`, runs `npm test`, installs
Chromium, then `npm run test:e2e`. On failure it uploads `playwright-report`
and `test-results` for 7 days. The auth project writes neither screenshots
nor traces.

### Add the secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**.

| Name | Value |
|---|---|
| `CHANGUTO_E2E_EMAIL` | Inbox Pollar will accept |
| `CHANGUTO_E2E_PASSWORD` | Only useful here if it is the 6-digit code. Any other value still runs the email step. |

Optional, same screen: `CHANGUTO_E2E_OTP` for the code when the password
secret should stay a password. The workflow does not pass `CHANGUTO_E2E_OTP`
unless you add it next to the other two in `e2e.yml`. Fork pull requests do
not receive these secrets; the auth spec skips there.

Never commit `e2e/.env` or a real inbox.
