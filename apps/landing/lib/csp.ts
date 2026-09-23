/**
 * Static response headers for the marketing site.
 *
 * A nonce would force every route to render dynamically, and once a nonce
 * is present browsers ignore `'unsafe-inline'`, which drops Next's style
 * attributes. This site is static. `unsafe-eval` stays on in dev because
 * the Next overlay needs it; production does not.
 *
 * The whitelist form loads Turnstile explicitly from
 * `https://challenges.cloudflare.com/turnstile/v0/api.js` and the script
 * paints the challenge in an iframe on that origin, then beacons back to
 * it. `frame-src 'none'` plus a script-src / connect-src that never named
 * the host left the widget div empty, so submit could only show the
 * missing-token copy. The FedRAMP, China and staging challenge hosts are
 * optional overrides inside that script; this form does not set one, so
 * they stay off the allowlist.
 *
 * `frame-ancestors` stays `'none'`. Allowing Turnstile's frame is not
 * permission for someone else to frame this site. Analytics hosts still
 * come only from `analyticsCspSources()`, so an unset id adds nothing.
 */

import { analyticsCspSources } from './analytics.ts';

/** Origin the Turnstile widget script, iframe and beacon actually use. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export function landingContentSecurityPolicy(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const isProd = nodeEnv === 'production';
  const vendors = analyticsCspSources();
  const scriptVendors = vendors.script.length ? ` ${vendors.script.join(' ')}` : '';
  const connectVendors = vendors.connect.length ? ` ${vendors.connect.join(' ')}` : '';
  const imgVendors = vendors.img.length ? ` ${vendors.img.join(' ')}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? '' : " 'unsafe-eval'"}${scriptVendors} ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${imgVendors}`,
    "font-src 'self'",
    `connect-src 'self'${isProd ? '' : ' ws: wss:'}${connectVendors} ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function landingSecurityHeaders(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): { key: string; value: string }[] {
  const isProd = nodeEnv === 'production';
  const headers: { key: string; value: string }[] = [
    { key: 'Content-Security-Policy', value: landingContentSecurityPolicy(nodeEnv) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  ];
  if (isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }
  return headers;
}
