import { expect, test } from '@playwright/test';

import { emailLoginCode, optionalEnv } from './support/env';
import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

/**
 * Pollar 0.11 (the widget on app.changuito.me) has no password field.
 * Email login sends a 6-digit code. `CHANGUTO_E2E_PASSWORD` is only typed
 * when it is exactly six digits (or `CHANGUTO_E2E_OTP` is set). Otherwise
 * the test still opens the email path and stops at the code step.
 *
 * Traces, video, and screenshots stay off: this repo is public and a failed
 * auth run must not publish the test inbox or the code as an artifact.
 */
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('app auth', () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });

  test('email login reaches signed-in chrome when a code is available', async ({ page }) => {
    const email = optionalEnv('CHANGUTO_E2E_EMAIL');
    const password = optionalEnv('CHANGUTO_E2E_PASSWORD');
    test.skip(!email || !password, 'CHANGUTO_E2E_EMAIL and CHANGUTO_E2E_PASSWORD are not both set');
    test.slow();

    const errors = collectPageErrors(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Empezá a comprar' }).click();

    const modal = page.locator('.pollar-modal');
    await expect(modal.getByText('Log in or sign up')).toBeVisible();

    // The card renders "Loading..." before Pollar finishes its config fetch.
    const emailInput = modal.getByPlaceholder('you@email.com');
    const settled = emailInput
      .or(modal.getByRole('button', { name: 'Google' }))
      .or(modal.getByRole('button', { name: 'Wallet' }));
    await expect(settled).toBeVisible({ timeout: 20_000 });

    if (!(await emailInput.isVisible())) {
      test.info().annotations.push({
        type: 'limitation',
        description:
          'The Pollar modal did not offer an email field. Google or wallet login is what the widget showed; those are not driven from CI.',
      });
      test.skip(true, 'Pollar email login is not offered in this build');
    }

    await emailInput.fill(email!);
    await modal.getByRole('button', { name: 'Submit' }).click();

    const codePrompt = modal.getByText(/6-digit code/i);
    await expect(codePrompt).toBeVisible({ timeout: 25_000 });

    const code = emailLoginCode();
    if (!code) {
      test.info().annotations.push({
        type: 'limitation',
        description:
          'Email was submitted and Pollar asked for a 6-digit code. CHANGUTO_E2E_PASSWORD is not that code, and Pollar has no password field, so signed-in chrome was not asserted.',
      });
      expectNoPageErrors(errors);
      return;
    }

    const firstDigit = modal.locator('input.pollar-code-input').first();
    await firstDigit.click();
    await page.keyboard.type(code, { delay: 40 });

    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Tu pago')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cargar USDC' })).toBeVisible();
    expectNoPageErrors(errors);
  });
});
