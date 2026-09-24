import { expect, test } from '@playwright/test';

import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

test.describe('landing', () => {
  test('home loads, nav anchors resolve, and the CTA stays on the whitelist', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: /Pedí el súper/ })).toBeVisible();
    await expect(page.getByText('Changuito compara productos, arma el carrito').first()).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pagos' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ayuda' })).toBeVisible();

    await nav.getByRole('link', { name: 'Cómo funciona' }).click();
    await expect(page.locator('#como-funciona')).toBeInViewport();

    await nav.getByRole('link', { name: 'Pagos' }).click();
    await expect(page.locator('#pagos')).toBeInViewport();

    await nav.getByRole('link', { name: 'Ayuda' }).click();
    await expect(page.locator('#faq')).toBeInViewport();

    const faq = page.getByRole('button', { name: '¿Cómo pago?' });
    await faq.click();
    await expect(faq).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Con tarjeta o USDC.', { exact: true })).toBeVisible();

    const ctas = page.getByRole('link', { name: 'Probar Changuito' });
    await expect(ctas.first()).toBeVisible();
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(ctas.nth(i)).toHaveAttribute('href', '/whitelist');
    }

    await ctas.first().click();
    await expect(page).toHaveURL(/\/whitelist\/?$/);
    await expect(page.getByRole('heading', { level: 1, name: /lista para beta/ })).toBeVisible();
    expectNoPageErrors(errors);
  });

  test('whitelist rejects an empty form and an invalid email', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/whitelist');

    await expect(page.getByRole('heading', { level: 1, name: /lista para beta/ })).toBeVisible();
    await page.getByRole('button', { name: 'Anotame' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Completá tu nombre.' }).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Completá tu email.' }).first()).toBeVisible();

    await page.getByLabel('Nombre').fill('Ana');
    await page.getByLabel('Email').fill('no-es-un-email');
    await page.getByRole('button', { name: 'Anotame' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Revisá tu email.' }).first()).toBeVisible();
    await expect(page.getByText('Listo, te anotamos')).toHaveCount(0);
    expectNoPageErrors(errors);
  });
});
