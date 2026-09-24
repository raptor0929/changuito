import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load `e2e/.env` without overriding variables already set (CI secrets win).
 * The file is gitignored. `e2e/.env.example` documents the keys.
 */
export function loadLocalEnv(filename = 'e2e/.env'): void {
  const path = resolve(filename);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Pollar email login is a 6-digit code, not a password. See docs/e2e.md. */
export function emailLoginCode(): string | undefined {
  const explicit = optionalEnv('CHANGUTO_E2E_OTP');
  if (explicit) return explicit;
  const password = optionalEnv('CHANGUTO_E2E_PASSWORD');
  if (password && /^\d{6}$/.test(password)) return password;
  return undefined;
}
