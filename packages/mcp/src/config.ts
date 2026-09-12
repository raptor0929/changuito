import { resolve } from 'node:path';

/**
 * Every environment variable the system reads, in one place, with its default
 * and its validation. Nothing else in the codebase touches `process.env`.
 *
 * Two reasons this is a module rather than scattered `process.env` reads:
 * a wrong value here spends money or leaks a session, so the validation needs
 * to be somewhere it can be unit-tested; and SETUP.md's configuration section
 * is generated from the same list, so it cannot drift out of date.
 */

export type FundingAsset = 'btc' | 'eth' | 'sol' | 'usdt';

export interface AppConfig {
  /** Only Día is implemented end to end. The others stay on the read-only path. */
  retailer: string;
  host: string;

  secretsDir: string;
  sessionVaultPath: string;
  keystorePath: string;

  vyrion: {
    apiKey: string;
    baseUrl?: string;
    allowLive: boolean;
    /** MCC whitelist applied to every card we create. 5411 = grocery stores. */
    allowedCategories: string[];
  };

  fx: {
    /** Overrides the network lookup entirely when set. */
    override?: number;
    buffer: number;
  };

  jev: {
    enabled: boolean;
    apiKey?: string;
    minConfidence: number;
    baseUrl: string;
  };

  browser: {
    /** Headless for everything except the login capture, which is always headed. */
    headless: boolean;
    /** Hard ceiling on the navigation loop. */
    maxSteps: number;
    maxMs: number;
    slowMoMs: number;
  };

  wallet: {
    asset: FundingAsset;
    rpcUrl?: string;
    /** Chain the EOA sends from. 1 = Ethereum mainnet. */
    chainId: number;
    usdtAddress?: string;
  };

  /** Live money requires this AND a restated amount on the tool call. */
  allowLiveRun: boolean;
}

export class ConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off', '']);

export function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw new ConfigError(name, `${name} must be true or false, got "${raw}".`);
}

export function num(
  env: Env,
  name: string,
  fallback: number | undefined,
  min: number,
  max: number,
): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ConfigError(name, `${name} must be a number, got "${raw}".`);
  }
  if (n < min || n > max) {
    throw new ConfigError(name, `${name} must be between ${min} and ${max}, got ${n}.`);
  }
  return n;
}

const HOSTS: Record<string, string> = {
  dia: 'diaonline.supermercadosdia.com.ar',
  carrefour: 'www.carrefour.com.ar',
  jumbo: 'www.jumbo.com.ar',
  disco: 'www.disco.com.ar',
};

export function loadConfig(env: Env = process.env): AppConfig {
  const retailer = (env.RETAILER ?? 'dia').trim().toLowerCase();
  const host = HOSTS[retailer];
  if (!host) {
    throw new ConfigError(
      'RETAILER',
      `Unknown retailer "${retailer}". Known: ${Object.keys(HOSTS).join(', ')}. ` +
        'Only "dia" is implemented through checkout.',
    );
  }

  const secretsDir = resolve(env.SECRETS_DIR ?? '.secrets');
  const allowLiveRun = bool(env, 'ALLOW_LIVE', false);

  const apiKey = (env.VYRION_API_KEY ?? '').trim();
  if (apiKey.startsWith('sk_live_') && !allowLiveRun) {
    // Caught here as well as in VyrionClient, so `describeConfig` can warn the
    // user before anything has tried to spend.
    throw new ConfigError(
      'VYRION_API_KEY',
      'A live Vyrion key is configured but ALLOW_LIVE is not set. Refusing to start ' +
        'in a state where one mistyped tool call spends real money.',
    );
  }

  const jevEnabled = bool(env, 'JEV_ENABLED', Boolean(env.TYPESAFE_API_KEY));
  if (jevEnabled && !env.TYPESAFE_API_KEY) {
    throw new ConfigError(
      'TYPESAFE_API_KEY',
      'JEV_ENABLED is on but TYPESAFE_API_KEY is not set. Set the key, or set ' +
        'JEV_ENABLED=false to run on the deterministic classifier layers only.',
    );
  }

  const asset = (env.FUNDING_ASSET ?? 'usdt').trim().toLowerCase();
  if (!['btc', 'eth', 'sol', 'usdt'].includes(asset)) {
    throw new ConfigError(
      'FUNDING_ASSET',
      `FUNDING_ASSET must be one of btc, eth, sol, usdt (Vyrion supports no others — ` +
        `notably no Stellar). Got "${asset}".`,
    );
  }
  if (asset === 'btc' || asset === 'sol') {
    // We can only sign EVM transfers. BTC/SOL deposits are possible but the
    // user has to send them by hand.
    // Not fatal: replenish_wallet will say so rather than pretending.
  }

  return {
    retailer,
    host,
    secretsDir,
    sessionVaultPath: resolve(secretsDir, `${retailer}.session.enc`),
    keystorePath: resolve(env.KEYSTORE_PATH ?? resolve(secretsDir, 'wallet.keystore.json')),

    vyrion: {
      apiKey,
      baseUrl: env.VYRION_BASE_URL,
      allowLive: allowLiveRun,
      allowedCategories: (env.ALLOWED_MCC ?? '5411,5499,5311')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },

    fx: {
      override: num(env, 'ARS_PER_USD', undefined, 50, 100_000),
      buffer: num(env, 'FX_BUFFER', 0.15, 0, 1) as number,
    },

    jev: {
      enabled: jevEnabled,
      apiKey: env.TYPESAFE_API_KEY,
      minConfidence: num(env, 'JEV_MIN_CONFIDENCE', 0.75, 0, 1) as number,
      baseUrl: env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai/v1/systemone',
    },

    browser: {
      headless: bool(env, 'HEADLESS', true),
      maxSteps: num(env, 'MAX_STEPS', 25, 1, 200) as number,
      maxMs: (num(env, 'MAX_MINUTES', 4, 0.5, 30) as number) * 60_000,
      slowMoMs: num(env, 'SLOWMO_MS', 0, 0, 5_000) as number,
    },

    wallet: {
      asset: asset as FundingAsset,
      rpcUrl: env.RPC_URL,
      chainId: num(env, 'CHAIN_ID', 1, 1, 1e9) as number,
      usdtAddress: env.USDT_ADDRESS,
    },

    allowLiveRun,
  };
}

/**
 * A human-readable configuration dump with no secret values in it — only
 * whether each one is present. Used by the `diagnose` tool and by SETUP.md's
 * troubleshooting section.
 */
export function describeConfig(cfg: AppConfig): string {
  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const set = (v: string | undefined) => (v ? 'set' : 'NOT SET');
  return [
    `retailer:        ${cfg.retailer} (${cfg.host})`,
    `secrets dir:     ${cfg.secretsDir}`,
    `session vault:   ${cfg.sessionVaultPath}`,
    `keystore:        ${cfg.keystorePath}`,
    `vyrion key:      ${set(cfg.vyrion.apiKey || undefined)}${
      cfg.vyrion.apiKey.startsWith('sk_live_') ? ' (LIVE)' : ' (sandbox)'
    }`,
    `allowed MCCs:    ${cfg.vyrion.allowedCategories.join(', ')}`,
    `FX buffer:       ${(cfg.fx.buffer * 100).toFixed(0)}%${
      cfg.fx.override ? ` (rate pinned to ${cfg.fx.override} ARS/USD)` : ''
    }`,
    `Jev classifier:  ${yn(cfg.jev.enabled)}${
      cfg.jev.enabled ? ` (min confidence ${cfg.jev.minConfidence})` : ' — layers 1, 2 and 4 only'
    }`,
    `browser:         ${cfg.browser.headless ? 'headless' : 'headed'}, budget ${
      cfg.browser.maxSteps
    } steps / ${Math.round(cfg.browser.maxMs / 60_000)} min`,
    `funding asset:   ${cfg.wallet.asset}${
      cfg.wallet.asset === 'btc' || cfg.wallet.asset === 'sol'
        ? ' (not EVM — replenish_wallet cannot sign this; send by hand)'
        : ''
    }`,
    `live spending:   ${yn(cfg.allowLiveRun)}`,
  ].join('\n');
}

/**
 * Passphrases are read from the environment rather than prompted, because the
 * MCP server runs over stdio and has no terminal to prompt on. The one entry
 * point with a terminal, `keystore-cli.ts`, prompts for its own passphrase and
 * only falls back to this when WALLET_PASSPHRASE is already exported.
 */
/**
 * The same passphrase, for the one caller that can ask a human instead: the
 * keystore CLI. Returns undefined when unset so the CLI can prompt, but still
 * rejects a too-short value rather than letting a weak one through a different
 * door than `requirePassphrase`.
 */
export function passphraseFromEnv(
  name: 'SESSION_PASSPHRASE' | 'WALLET_PASSPHRASE',
  env: Env = process.env,
): string | undefined {
  const v = env[name];
  if (v === undefined || v === '') return undefined;
  if (v.length < 8) {
    throw new ConfigError(name, `${name} is set but is shorter than 8 characters. Use a longer one, or unset it and be prompted.`);
  }
  return v;
}

export function requirePassphrase(name: 'SESSION_PASSPHRASE' | 'WALLET_PASSPHRASE', env: Env = process.env): string {
  const v = env[name];
  if (!v || v.length < 8) {
    throw new ConfigError(
      name,
      `${name} must be set to at least 8 characters. It is the only thing standing ` +
        `between a copy of ${name === 'SESSION_PASSPHRASE' ? 'your supermarket session' : 'your wallet keystore'} ` +
        `and whoever has the file. Set it in your MCP client's env block and restart it.`,
    );
  }
  return v;
}
