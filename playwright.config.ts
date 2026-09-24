import { defineConfig, devices } from '@playwright/test';

import { loadLocalEnv } from './e2e/support/env';

loadLocalEnv();

const landingBaseURL = process.env.LANDING_BASE_URL?.trim() || 'https://www.changuito.me';
const appBaseURL = process.env.APP_BASE_URL?.trim() || 'https://app.changuito.me';

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
  projects: [
    {
      name: 'landing',
      testMatch: /landing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: landingBaseURL },
    },
    {
      name: 'app',
      testMatch: /app-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: appBaseURL },
    },
  ],
});
