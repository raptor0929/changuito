import { expect, test } from '@playwright/test';

import { APP } from './support/app-copy';
import { collectPageErrors, expectNoPageErrors } from './support/page-errors';
import { POLLAR } from './support/pollar-copy';

const STARTER = 'Compará precios de leche con proteína';

/**
 * Guest smoke against production.
 *
 * Chat sits behind Cloudflare Turnstile (`human-gate`). A real browser often
 * passes it; automation often does not. Either settled state is a pass:
 * the verification screen, or the composer. We do not wait for product
 * search — that path is slow. We do wait for the first reply to a starter:
 * the postal-code question, which is what used to hang for guests (#51).
 */
test.describe('app guest', () => {
  test('loads guest chrome and either chats or stops on the human check', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');

    // The name lives on the h1 either way: as the wordmark's alt before #51,
    // as visually hidden text after it.
    await expect(page.getByRole('heading', { level: 1, name: 'Changuito' })).toBeVisible();
    await expect(page.getByText('Contale a Changuito lo que necesitás')).toBeVisible();
    await expect(page.getByRole('button', { name: APP.loginAction })).toBeVisible();

    const composer = page.getByTestId('composer');
    const verification = page.getByRole('heading', {
      name: /Confirmá que sos una persona|Hace falta una verificación/,
    });
    await expect(composer.or(verification)).toBeVisible({ timeout: 30_000 });

    // The widget title is on screen while Turnstile runs. Give a managed
    // challenge a chance to clear before treating the gate as the outcome.
    if (!(await composer.isVisible())) {
      try {
        await expect(composer).toBeVisible({ timeout: 12_000 });
      } catch {
        // Still on the human check. That is a valid guest smoke.
      }
    }

    const chatting = await composer.isVisible();
    test.info().annotations.push({
      type: 'surface',
      description: chatting ? 'composer' : 'human-gate',
    });

    if (chatting) {
      const loginWall = page.getByTestId('login-gate-banner');
      const starter = page.getByRole('button', { name: STARTER });
      if (await loginWall.isVisible()) {
        await expect(page.getByRole('button', { name: 'Iniciá sesión' })).toBeVisible();
      } else if (await starter.isVisible()) {
        await starter.click();
        const thread = page.getByTestId('chat-thread');
        await expect(thread.getByText(STARTER)).toBeVisible();
        // A starter names no postal code, so the first reply asks for one.
        // The server answers it without a model hop; the long timeout only
        // covers a run that lands before the new build is live.
        await expect(thread.getByText(/código postal/i).first()).toBeVisible({ timeout: 60_000 });
        const stop = page.getByRole('button', { name: 'Parar respuesta' });
        try {
          await stop.click({ timeout: 3_000 });
        } catch {
          // The prompt is already in the thread. Stopping only cuts the search short.
        }
      } else {
        const prompt = 'lista corta de prueba';
        await composer.locator('textarea').fill(prompt);
        await page.getByTestId('composer-send').click();
        await expect(page.getByTestId('chat-thread').getByText(prompt)).toBeVisible();
      }
    } else {
      await expect(verification).toBeVisible();
      await expect(page.getByTestId('human-gate')).toBeVisible();
    }

    expectNoPageErrors(errors);
  });

  test('login modal offers email and does not ask for a password', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');
    await page.getByRole('button', { name: APP.loginAction }).click();

    const modal = page.locator('.pollar-modal');
    await expect(modal.getByText(POLLAR.subtitle)).toBeVisible();
    await expect(modal.getByPlaceholder(POLLAR.emailPlaceholder)).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByRole('button', { name: POLLAR.submit })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Google' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Wallet' })).toBeVisible();
    await expect(modal.locator('input[type="password"]')).toHaveCount(0);

    await modal.getByRole('button', { name: POLLAR.close }).click();
    await expect(modal).toBeHidden();
    expectNoPageErrors(errors);
  });
});
