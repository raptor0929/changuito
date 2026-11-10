import { bindings, defineConfig, defineWorker } from "cf/config";

const publicNames = [
  "NEXT_PUBLIC_POLLAR_API_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_GA_MEASUREMENT_ID",
  "NEXT_PUBLIC_META_PIXEL_ID",
  "NEXT_PUBLIC_CLARITY_PROJECT_ID",
] as const;

// Present only for the machine that builds. Absent keys stay on the dashboard
// instead of being wiped by a deploy that does not have them.
const publicEnv = Object.fromEntries(
  publicNames.flatMap((name) => {
    const value = process.env[name];
    return value ? [[name, bindings.text(value)]] : [];
  }),
);

// The testnet contracts the live Worker calls, as set on its dashboard. They
// are runtime variables, so the build machine does not have them, and a deploy
// that left them out would delete them; strict mode refuses that deploy
// instead. Pinned here rather than read from deployments.json, which lags the
// upgradeable escrow. Moving the shop to another contract means changing these
// and the dashboard together. The mainnet pair stays undeclared on purpose.
const contractIds = {
  STELLAR_ESCROW_ID: bindings.text("CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S"),
  STELLAR_USDC_ID: bindings.text("CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E"),
};

// Soroban RPC, same reason as the contract ids: a deploy that left them out
// would delete the dashboard binding, and strict mode refuses that. Testnet
// is Gateway; mainnet stays on the host the app already uses. Changing either
// means changing this and the dashboard together.
const rpcUrls = {
  STELLAR_RPC_URL: bindings.text("https://soroban-rpc.testnet.stellar.gateway.fm"),
  STELLAR_RPC_URL_MAINNET: bindings.text("https://mainnet.sorobanrpc.com"),
};

// Which Postgres this Worker reaches is a decision, not a default: the
// database is a privacy boundary between the two apps. No id, no binding, and
// the app runs without a database the way a fresh clone does.
const hyperdriveId = process.env.CHG_HYPERDRIVE_ID?.trim();

export default defineConfig({
  worker: defineWorker({
    // The Worker that owns app.changuito.me. Deployed by Workers Builds from
    // this repo's main branch.
    name: "changuito-web",
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-11-02",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    // The domain this Worker already owns, declared so a deploy leaves it as
    // it is. A hostname belongs to one Worker, so ste.changuito.me stays on
    // changuito-ste.
    domains: [
      { hostname: "app.changuito.me", production: true, previews: false },
    ],
    workersDev: true,
    previewUrls: false,
    env: {
      ASSETS: bindings.assets(),
      // The app reads NODE_ENV at runtime, and on a Worker process.env holds
      // only the bindings. Without this every fail-closed rule (the human
      // gate, the faucet and real-mode lists, the quotas, the session secret)
      // takes its development branch and opens.
      NODE_ENV: bindings.text("production"),
      ...(hyperdriveId ? { HYPERDRIVE: bindings.hyperdrive({ id: hyperdriveId }) } : {}),
      ...contractIds,
      ...rpcUrls,
      ...publicEnv,
    },
  }),
});
