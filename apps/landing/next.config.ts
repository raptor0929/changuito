import type { NextConfig } from 'next';

/**
 * Static CSP, not a per-request nonce.
 *
 * A nonce forces every route to render dynamically, and once a nonce is
 * present browsers ignore `'unsafe-inline'`, which drops Next's style
 * attributes. This page is static. The policy still refuses framing, plugins
 * and base-tag overrides. `unsafe-eval` stays on in dev because the Next
 * overlay needs it; production does not.
 */
function securityHeaders(): { key: string; value: string }[] {
  const isProd = process.env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers: { key: string; value: string }[] = [
    { key: 'Content-Security-Policy', value: csp },
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

const config: NextConfig = {
  poweredByHeader: false,
  // Shared footer trust line. Source is TypeScript, compiled with the app.
  transpilePackages: ['@changuito/trust'],
  // Next 16 blocks the dev HMR socket when the browser host is 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1'],
  // Hoisted workspace deps live at the repo root, not in this package.
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default config;
