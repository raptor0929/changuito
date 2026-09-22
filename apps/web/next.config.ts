import type { NextConfig } from 'next';

/**
 * Static CSP, not a per-request nonce.
 *
 * A nonce policy forces every route to render dynamically and, once a nonce
 * is present, browsers ignore `'unsafe-inline'` — which drops Next's style
 * attributes. The landing is meant to stay static. This policy still refuses
 * framing, plugins and base-tag overrides. `unsafe-eval` stays on in dev
 * because the Next overlay needs it; production does not.
 */
function securityHeaders(): { key: string; value: string }[] {
  const isProd = process.env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
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
  // Next 16 blocks the dev HMR socket when the browser host is 127.0.0.1,
  // which leaves the page as static HTML. Localhost is allowed by default.
  allowedDevOrigins: ['127.0.0.1'],
  // `@changuito/mcp` is a workspace package of compiled ESM. It gets bundled
  // rather than marked external, because a symlinked workspace package that
  // Next treats as external is not traced into the lambda at all and fails at
  // runtime with MODULE_NOT_FOUND.
  //
  // Bundling it is only safe because `@changuito/mcp/server` has no reference
  // to the checkout module — not even a dynamic one, which a bundler would
  // resolve at build time anyway. See packages/mcp/src/server.ts.
  // The two bindings packages are `stellar contract bindings typescript`
  // output, published from src/ with no dist — see scripts/fixup-bindings.mjs.
  // They are TypeScript, so they must be compiled here rather than treated as
  // ready-made node modules.
  transpilePackages: ['@changuito/mcp', '@changuito/escrow-bindings', '@changuito/usdc-bindings'],

  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,

  // www.changuito.me is the landing at `/`. The shopper stays in this app
  // and is what app.changuito.me should show at its own `/`.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          has: [{ type: 'host', value: 'app.changuito.me' }],
          destination: '/agent',
        },
      ],
    };
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },

  // Belt and braces. If the boundary above ever slips, this is the second
  // thing that has to fail before a browser engine ships in a lambda.
  outputFileTracingExcludes: {
    '/api/**': [
      './node_modules/playwright/**',
      './node_modules/playwright-core/**',
      './node_modules/ethers/**',
      './packages/mcp/dist/checkout/**',
      './packages/mcp/dist/wallet/**',
    ],
  },
};

export default config;
