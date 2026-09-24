import { expect, type Page } from '@playwright/test';

const IGNORED = [/ResizeObserver loop/i, /Non-Error promise rejection captured/i];

/** Collect uncaught exceptions. Call `expectNoPageErrors` at the end of the test. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (IGNORED.some((pattern) => pattern.test(message))) return;
    errors.push(message);
  });
  return errors;
}

export function expectNoPageErrors(errors: readonly string[]): void {
  expect(errors, 'uncaught pageerror').toEqual([]);
}
