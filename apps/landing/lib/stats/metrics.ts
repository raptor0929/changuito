/**
 * Public snapshot behind /stats.
 *
 * Counts are aggregates the team already published: no account, no email,
 * no postal code. Chain ids are the public program and the public contract
 * the dashboard links to. Day buckets sum to the month buckets; the tests
 * pin that so a hand edit cannot leave the two charts disagreeing.
 */

export const STATS_TITLE = 'Public Stats & On-Chain Metrics';

export const STATS_DESCRIPTION =
  'Verified on-chain and product metrics for Changuito across both networks.';

export const HOME_URL = 'https://www.changuito.me';

/** Published snapshot day. Range windows count back from this, never from the clock. */
export const AS_OF = '2026-10-23';

/** Series fills. Text badges use the ink paired with a fill that clears WCAG AA. */
export const SOLANA_COLOR = '#F4B942';
export const STELLAR_COLOR = '#E07A5F';
export const SEEKER_COLOR = '#2A1A14';
export const SEEKER_COLOR_DARK = '#F3E3C3';
/** Espresso on sunflower, and espresso on arcilla, both clear 4.5:1. */
export const BADGE_INK = '#2A1A14';
export const STELLAR_TEXT = '#B5482B';

export const SOLANA_PROGRAM_ID = 'BFa1gZL9kVVo8Mq5gaDRM5RiCG4NDiyHLbpymfXvLz9d';
/** Escrow and demo USDC on Stellar testnet. Source of truth: deployments.json at the repo root. */
export const STELLAR_CONTRACT_ID = 'CCA3ES6ANWAAJXB436XTSPGFRGX5GDZLHC7UOF25K4B5OFDJML4JG7EX';
export const STELLAR_USDC_ID = 'CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E';
/** Public Stellar testnet accounts that sign or receive the app's on-chain actions. */
export const STELLAR_RESOLVER = 'GBXBAOFWG4Y4ZQEDXH73BACYYCE7ODSKXHLXYVRPLJOYFRDCPWHGYGN5';
export const STELLAR_TREASURY = 'GBKJHIKIZONKCCV2JVOGUDXEOPTQUZ2OKYZNV3R3LDALNZHCSF2JJEIF';
export const STELLAR_DEMO_WALLET = 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X';

export const TOTALS: Totals = {
  endUsers: 30,
  endUsersDelta30d: 30,
  realOrders: 1,
  txSolana: 59,
  txStellar: 26,
  txDelta30d: 59,
  cartsSolana: 28,
  cartsStellar: 5,
  settled: 19,
  settledUsdc: '206.99',
  stellarMints: 10,
  walletsSolana: 13,
  walletsStellar: 8,
  buyers: 15,
  infra: 6,
  escrowOpen: 33,
  escrowRefund: 13,
  tokenMintInit: 20,
  mergedPrs: 102,
  appAccounts: null,
};

export interface Totals {
  endUsers: number;
  /** Null when the live source cannot say how many joined in the window. */
  endUsersDelta30d: number | null;
  realOrders: number;
  txSolana: number;
  txStellar: number;
  txDelta30d: number;
  cartsSolana: number;
  cartsStellar: number;
  settled: number;
  settledUsdc: string;
  stellarMints: number;
  walletsSolana: number;
  walletsStellar: number;
  buyers: number;
  infra: number;
  escrowOpen: number;
  escrowRefund: number;
  tokenMintInit: number;
  mergedPrs: number;
  /** Signed-in app accounts across both apps; null until a database read is configured. */
  appAccounts: number | null;
}

/** Which source each number came from. 'snapshot' means the last published value. */
export type SourceState = 'live' | 'snapshot';

export interface Sources {
  solana: SourceState;
  stellar: SourceState;
  waitlist: SourceState;
  appDb: SourceState;
  github: SourceState;
}

/**
 * Everything the dashboard and the CSV read. Built server-side; holds only
 * public aggregates and public transaction hashes, never an address list,
 * an email or a credential.
 */
export interface StatsSnapshot {
  /** Calendar day the range windows count back from (UTC). */
  asOf: string;
  /** ISO time the live read finished, or null for the published snapshot. */
  updatedAt: string | null;
  totals: Totals;
  txDay: readonly Point[];
  cartDay: readonly Point[];
  recentTxs: readonly TxRef[];
  sources: Sources;
}

export interface Point {
  label: string;
  /** Calendar day of the bucket, UTC. Range filters use this. */
  iso: string;
  solana: number;
  stellar: number;
}

export const TX_DAY: readonly Point[] = [
  { label: '09/21', iso: '2026-09-21', solana: 0, stellar: 24 },
  { label: '09/23', iso: '2026-09-23', solana: 0, stellar: 2 },
  { label: '10/04', iso: '2026-10-04', solana: 20, stellar: 0 },
  { label: '10/09', iso: '2026-10-09', solana: 9, stellar: 0 },
  { label: '10/10', iso: '2026-10-10', solana: 6, stellar: 0 },
  { label: '10/11', iso: '2026-10-11', solana: 24, stellar: 0 },
];

export const TX_MONTH: readonly Point[] = [
  { label: '09/26', iso: '2026-09-26', solana: 0, stellar: 26 },
  { label: '10/26', iso: '2026-10-26', solana: 59, stellar: 0 },
];

export const CART_DAY: readonly Point[] = [
  { label: '09/21', iso: '2026-09-21', solana: 0, stellar: 5 },
  { label: '09/23', iso: '2026-09-23', solana: 0, stellar: 0 },
  { label: '10/04', iso: '2026-10-04', solana: 9, stellar: 0 },
  { label: '10/09', iso: '2026-10-09', solana: 4, stellar: 0 },
  { label: '10/10', iso: '2026-10-10', solana: 3, stellar: 0 },
  { label: '10/11', iso: '2026-10-11', solana: 12, stellar: 0 },
];

export const CART_MONTH: readonly Point[] = [
  { label: '09/26', iso: '2026-09-26', solana: 0, stellar: 5 },
  { label: '10/26', iso: '2026-10-26', solana: 28, stellar: 0 },
];

export interface EngineeringRow {
  id: string;
  label: string;
  chain: 'solana' | 'stellar';
  tests: number;
}

export const ENGINEERING: readonly EngineeringRow[] = [
  { id: 'web-stellar', label: '@changuito/web · stellar', chain: 'stellar', tests: 682 },
  { id: 'web-solana', label: '@changuito/web · solana', chain: 'solana', tests: 650 },
  { id: 'landing-solana', label: '@changuito/landing · solana', chain: 'solana', tests: 77 },
  { id: 'landing-stellar', label: '@changuito/landing · stellar', chain: 'stellar', tests: 75 },
];

export interface TxRef {
  network: 'solana' | 'stellar';
  hash: string;
}

export const RECENT_TXS: readonly TxRef[] = [
  {
    network: 'solana',
    hash: '2Mty3w4CJ4hxxMH3gNqruonJSSgxDbFirhzQqvNpo4UtTUfzp1A1hRbSG8qSNzmVGhUe4Jdvv1pjWa6ju1s5stCD',
  },
  {
    network: 'solana',
    hash: '5viAna58Hxc18QcjQB87mSXJCiYc8n3GAhePPKRQvzHufKx9RReKt5F9LTK6vGwVBZLFuM6Np5jK3fAu9tQpcmUy',
  },
  {
    network: 'solana',
    hash: '2tjg8EzmJoTgveUHG2K9UZUuiinTTiHWPknMewV2CsSHjbvKqh6r1rtEjT5544UHVkPi9SZiZ1CTHkzyL3mE4Jq4',
  },
  {
    network: 'solana',
    hash: '5qBwCrxeHhd2ePMRSyYQek5g4sHeJfcANZJQXaxGMF5XYjy9BSqsK1kLWZMRfCEvPvgnfX6b6ty6jKDxu4kmnWeo',
  },
  { network: 'stellar', hash: '240714181f04d8f4c420844dfbf1f0b66edabb87b1539e59c07da7475b8a657e' },
  { network: 'stellar', hash: '59e5a1655b336401b0be4ef80002ea1e57297e3409b95a61893cb43c6b92577d' },
];

export const FALLBACK_SNAPSHOT: StatsSnapshot = {
  asOf: AS_OF,
  updatedAt: null,
  totals: TOTALS,
  txDay: TX_DAY,
  cartDay: CART_DAY,
  recentTxs: RECENT_TXS,
  sources: { solana: 'snapshot', stellar: 'snapshot', waitlist: 'snapshot', appDb: 'snapshot', github: 'snapshot' },
};

/** Month buckets (labelled MM/YY, dated the 1st) rolled up from day buckets. */
export function monthBuckets(days: readonly Point[]): Point[] {
  const byMonth = new Map<string, Point>();
  for (const day of days) {
    const key = day.iso.slice(0, 7);
    const bucket = byMonth.get(key) ?? { label: `${key.slice(5, 7)}/${key.slice(2, 4)}`, iso: `${key}-01`, solana: 0, stellar: 0 };
    bucket.solana += day.solana;
    bucket.stellar += day.stellar;
    byMonth.set(key, bucket);
  }
  return [...byMonth.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

export function txHref(tx: TxRef): string {
  if (tx.network === 'solana') return `https://solscan.io/tx/${tx.hash}?cluster=devnet`;
  return `https://stellar.expert/explorer/testnet/tx/${tx.hash}`;
}

export function contractHref(network: TxRef['network']): string {
  if (network === 'solana') return `https://solscan.io/account/${SOLANA_PROGRAM_ID}?cluster=devnet`;
  return `https://stellar.expert/explorer/testnet/contract/${STELLAR_CONTRACT_ID}`;
}

export function contractId(network: TxRef['network']): string {
  return network === 'solana' ? SOLANA_PROGRAM_ID : STELLAR_CONTRACT_ID;
}

/** Short public id for a table cell. Full value stays on the link. */
export function shortId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
