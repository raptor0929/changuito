import type { NextConfig } from 'next';

const config: NextConfig = {
  // The MCP package and the generated contract bindings ship as ESM/TS and are
  // consumed straight from the workspace, so Next has to compile them itself.
  transpilePackages: ['@changuito/mcp'],

  // Playwright is a dependency of the MCP package's checkout half, which this
  // app never loads (see packages/mcp/src/index.ts -- the checkout tools are a
  // lazy import). Telling the bundler that keeps it out of the lambda entirely.
  outputFileTracingExcludes: {
    '/api/**': ['./node_modules/playwright/**', './node_modules/playwright-core/**'],
  },
};

export default config;
