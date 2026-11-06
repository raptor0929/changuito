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

// Which Postgres this Worker reaches is a decision, not a default: the
// database is a privacy boundary between the two apps. No id, no binding, and
// the app runs without a database the way a fresh clone does — except on
// Workers Builds, where a deploy without it would ship a production app with
// no database, so it stops there instead.
const hyperdriveId = process.env.CHG_HYPERDRIVE_ID?.trim();
if (!hyperdriveId && process.env.WORKERS_CI === "1") {
  throw new Error("CHG_HYPERDRIVE_ID is not set as a build variable: refusing to deploy without the database.");
}

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
      ...publicEnv,
    },
  }),
});
