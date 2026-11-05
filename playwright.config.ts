import { defineConfig, devices } from '@playwright/test';

import { loadLocalEnv } from './e2e/support/env';

loadLocalEnv();

const landingBaseURL = process.env.LANDING_BASE_URL?.trim() || 'https://www.changuito.me';
const appBaseURL = process.env.APP_BASE_URL?.trim() || 'https://app.changuito.me';

/**
 * The checkout spec is the one that cannot run against a deployment.
 *
 * `app/dev/checkout` — the fixture the modal frames in the store's place in
 * modo prueba — `notFound()`s in production, on purpose: a page that says
 * "pagado" and takes no money has no business on a real deployment. So this
 * project gets its own base URL and its own `next dev`, while `landing` and
 * `app` keep pointing at what is live.
 *
 * Port 3124 matches `npm run dev`, so a server already open for hacking is
 * reused rather than fought with.
 */
const checkoutBaseURL = process.env.CHECKOUT_BASE_URL?.trim() || 'http://localhost:3124';

/**
 * Which projects this run asked for.
 *
 * Playwright starts every `webServer` in the config whatever `--project` says,
 * and only the checkout project needs one — starting a dev server for a
 * production smoke run would be waste in CI and a new way for it to fail. So
 * the server is added to the config only when this run includes `checkout`,
 * which means reading the command line, because that is where the answer is.
 */
const requested = new Set(
  process.argv.flatMap((arg, i) =>
    arg === '--project' ? [process.argv[i + 1]] : arg.startsWith('--project=') ? [arg.slice(10)] : [],
  ),
);
const runsCheckout = requested.size === 0 || requested.has('checkout');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [
        ['html', { open: 'never' }],
        ['github'],
        ['list'],
      ]
    : [
        ['html', { open: 'never' }],
        ['list'],
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  ...(runsCheckout
    ? {
        webServer: {
          command: 'npm run dev -w @changuito/web',
          url: checkoutBaseURL,
          // Next compiles on demand, and the first request pays for the whole
          // page. Three minutes is a cold `next dev` on a cold cache.
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }
    : {}),
  projects: [
    {
      name: 'landing',
      testMatch: /landing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: landingBaseURL },
    },
    {
      name: 'app',
      testMatch: /app-.*\.spec\.ts/,
      // Named rather than left to the pattern: `app-frame-checkout` is an
      // `app-` spec by name so it sits with its siblings, but it is the one
      // that needs a server of its own, and a production run of it would
      // frame a real supermarket.
      testIgnore: /app-frame-checkout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: appBaseURL },
    },
    {
      name: 'checkout',
      testMatch: /app-frame-checkout\.spec\.ts/,
      // The three-column shell starts at 1200px and the spec reads the rails.
      // Pinned rather than inherited: Desktop Chrome's 1280 is four pixels of
      // margin either side of a layout decision.
      use: {
        ...devices['Desktop Chrome'],
        baseURL: checkoutBaseURL,
        viewport: { width: 1440, height: 900 },
        // A PAN and a one-time code are on screen for most of this test, and
        // this repo is public. Same reason app-auth.spec.ts does it.
        trace: 'off',
        video: 'off',
        screenshot: 'off',
      },
      // A dev server compiling a route on first hit is slower than a warm
      // deployment, and the flow deliberately waits out two polls.
      timeout: 180_000,
    },
  ],
});
