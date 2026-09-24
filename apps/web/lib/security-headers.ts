import { ANALYTICS_IDS, type AnalyticsIds } from './analytics.ts';
import { DEPLOYMENTS, NETWORK_IDS } from './deployments.ts';

/**
 * Response headers for the shopper, mirroring www's (apps/landing/lib/csp.ts).
 *
 * The app shipped none, so any site could frame app.changuito.me and lay a
 * fake button over "Cargar USDC" or "Ya lo completé". `frame-ancestors 'none'`
 * plus X-Frame-Options is the fix; the rest is the same baseline www has.
 *
 * What the browser actually talks to, and so what the CSP names:
 * - Turnstile: script, iframe and beacon on challenges.cloudflare.com.
 * - Pollar: its SDK API (sdk.api.pollar.xyz), its logo (pollar.xyz), and the
 *   Stellar Horizon/RPC hosts it reads balances and submits through. OAuth
 *   and Albedo are top-level navigations and popups, which CSP does not
 *   restrict. Neither Pollar nor the Stellar SDK uses eval.
 * - Product photos: every retailer serves them from *.vtexassets.com.
 * - Analytics: only the vendors whose id is set, same as www.
 *
 * `'unsafe-inline'` for scripts stays for the reason www gives: a nonce makes
 * every route dynamic and drops Next's inline bootstrap otherwise. Pure so
 * next.config can call it and a test can pin it.
 */

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const POLLAR_API = 'https://sdk.api.pollar.xyz';
const POLLAR_ASSETS = 'https://pollar.xyz';
/**
 * Derived from lib/deployments.ts rather than listed, because the list and the
 * config drifting is a failure the browser reports as "fetch failed" from
 * inside the Stellar SDK — which reads like the network is down. Every chain
 * host the app can be pointed at is in DEPLOYMENTS by construction, so taking
 * them from there means adding a network cannot forget this file.
 */
const STELLAR = [
  ...new Set(NETWORK_IDS.flatMap((net) => [DEPLOYMENTS[net].horizonUrl, DEPLOYMENTS[net].rpcUrl])),
].map((url) => new URL(url).origin);
const PRODUCT_IMAGES = 'https://*.vtexassets.com';

export function analyticsCspSources(ids: AnalyticsIds = ANALYTICS_IDS): { script: string[]; connect: string[]; img: string[] } {
  const script: string[] = [];
  const connect: string[] = [];
  const img: string[] = [];
  if (ids.ga) {
    script.push('https://www.googletagmanager.com', 'https://www.google-analytics.com');
    connect.push(
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://analytics.google.com',
      'https://*.analytics.google.com',
      'https://www.googletagmanager.com',
      'https://stats.g.doubleclick.net',
    );
    img.push('https://www.google-analytics.com', 'https://www.googletagmanager.com');
  }
  if (ids.meta) {
    script.push('https://connect.facebook.net');
    connect.push('https://www.facebook.com', 'https://connect.facebook.net');
    img.push('https://www.facebook.com');
  }
  if (ids.clarity) {
    script.push('https://www.clarity.ms', 'https://scripts.clarity.ms');
    connect.push('https://www.clarity.ms', 'https://*.clarity.ms');
    img.push('https://www.clarity.ms', 'https://c.clarity.ms');
  }
  return { script, connect, img };
}

const join = (xs: string[]) => (xs.length ? ` ${xs.join(' ')}` : '');

export function appContentSecurityPolicy(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  ids: AnalyticsIds = ANALYTICS_IDS,
): string {
  const isProd = nodeEnv === 'production';
  const vendors = analyticsCspSources(ids);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? '' : " 'unsafe-eval'"}${join(vendors.script)} ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${PRODUCT_IMAGES} ${POLLAR_ASSETS}${join(vendors.img)}`,
    "font-src 'self' data:",
    `connect-src 'self'${isProd ? '' : ' ws: wss:'} ${POLLAR_API} ${STELLAR.join(' ')}${join(vendors.connect)} ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function appSecurityHeaders(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  ids: AnalyticsIds = ANALYTICS_IDS,
): { key: string; value: string }[] {
  const headers = [
    { key: 'Content-Security-Policy', value: appContentSecurityPolicy(nodeEnv, ids) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    // Passkeys (WebAuthn) keep their default of 'self'; nothing here names them.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ];
  if (nodeEnv === 'production') {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  }
  return headers;
}
