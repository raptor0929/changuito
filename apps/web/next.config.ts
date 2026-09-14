import type { NextConfig } from 'next';

const config: NextConfig = {
  // `@changuito/mcp` is a workspace package of compiled ESM. It gets bundled
  // rather than marked external, because a symlinked workspace package that
  // Next treats as external is not traced into the lambda at all and fails at
  // runtime with MODULE_NOT_FOUND.
  //
  // Bundling it is only safe because `@changuito/mcp/server` has no reference
  // to the checkout module — not even a dynamic one, which a bundler would
  // resolve at build time anyway. See packages/mcp/src/server.ts.
  transpilePackages: ['@changuito/mcp'],

  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,

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
