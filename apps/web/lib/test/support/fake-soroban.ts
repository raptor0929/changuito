/**
 * Stand-ins for the generated contract clients (@changuito/escrow-bindings,
 * @changuito/usdc-bindings), so routes that sign or simulate can be tested as
 * handlers: no RPC, no testnet, no resolver secret.
 *
 * The real bindings are TypeScript source that node's type stripping cannot
 * load (parameter properties, value-imported types), which is why those routes
 * had no tests at all. `mock.module` (node --experimental-test-module-mocks)
 * swaps the package for these before the route is imported.
 *
 * Every client records the options it was built with, so a test can check
 * which key would have signed, and every call it received.
 */
import { mock } from 'node:test';

/** The contract's Status enum, as a const object: type stripping cannot load a TS enum. */
export const Status = { Open: 0, Settled: 1, Refunded: 2 } as const;
export type Status = (typeof Status)[keyof typeof Status];

export interface FakeOrder {
  buyer: string;
  amount: bigint;
  basket_hash: Buffer;
  status: Status;
}

export interface Call {
  method: string;
  args: unknown;
  signedBy?: string;
}

export const chain = {
  orders: new Map<string, FakeOrder>(),
  balances: new Map<string, bigint>(),
  resolver: '',
  calls: [] as Call[],
  /** Throw from the next simulate/send, to test the failure paths. */
  fail: null as Error | null,
  reset() {
    this.orders.clear();
    this.balances.clear();
    this.calls = [];
    this.fail = null;
  },
};

type Opts = { publicKey?: string; signTransaction?: unknown; contractId?: string };

function assembled<T>(method: string, args: unknown, opts: Opts, result: T) {
  if (chain.fail) throw chain.fail;
  return {
    result,
    async signAndSend() {
      if (chain.fail) throw chain.fail;
      if (!opts.signTransaction) throw new Error('no signer');
      chain.calls.push({ method, args, signedBy: opts.publicKey });
      return { sendTransactionResponse: { hash: `tx-${method}-${chain.calls.length}` } };
    },
  };
}

class EscrowClient {
  readonly options: Opts;
  constructor(options: Opts) {
    this.options = options;
  }
  async find_order({ order_id }: { order_id: Buffer }) {
    chain.calls.push({ method: 'find_order', args: order_id.toString('hex') });
    return assembled('find_order', null, this.options, chain.orders.get(order_id.toString('hex')));
  }
  async config() {
    return assembled('config', null, this.options, { resolver: chain.resolver });
  }
  async settle(args: { order_id: Buffer; basket_hash: Buffer; receipt_hash: Buffer }) {
    return assembled('settle', { order: args.order_id.toString('hex'), receipt: args.receipt_hash.toString('hex') }, this.options, null);
  }
  async refund(args: { caller: string; order_id: Buffer }) {
    return assembled('refund', { order: args.order_id.toString('hex'), caller: args.caller }, this.options, null);
  }
}

class UsdcClient {
  readonly options: Opts;
  constructor(options: Opts) {
    this.options = options;
  }
  async balance({ id }: { id: string }) {
    return assembled('balance', id, this.options, chain.balances.get(id) ?? 0n);
  }
  async mint(args: { to: string; amount: bigint }) {
    return assembled('mint', { to: args.to, amount: args.amount.toString() }, this.options, null);
  }
}

export const RESOLVER_PUBLIC = 'GRESOLVERFAKE';

/** Call before importing any route that reaches the bindings. */
export function mockBindings(): void {
  mock.module('@changuito/escrow-bindings', { namedExports: { Client: EscrowClient, Status } });
  mock.module('@changuito/usdc-bindings', { namedExports: { Client: UsdcClient } });
}

/**
 * Also replace lib/server/resolver.ts, for route tests that need the resolver
 * to sign: the real one only accepts the deployed key, which no test has.
 * lib/test/resolver.test.ts covers the real module's refusals.
 *
 * Settle/refund go through Channels now, so the resolver mock also installs
 * the Channels close fake — same boundary the live route crosses.
 */
export function mockResolver(): void {
  const signer = { publicKey: RESOLVER_PUBLIC, signTransaction: async () => ({}) };
  const keypair = { publicKey: () => RESOLVER_PUBLIC };
  mock.module(new URL('../../server/resolver.ts', import.meta.url).href, {
    namedExports: {
      escrowAsResolver: () => new EscrowClient(signer),
      usdcAsAdmin: () => new UsdcClient(signer),
      resolverKeypair: () => keypair,
    },
  });
  mockChannelsClose();
}

/**
 * Stand-in for lib/server/channels.ts close path. Records settle/refund on
 * `chain.calls` with the resolver as signer, so settle-route assertions keep
 * checking authorization without a live Channels submit. `chain.fail` still
 * makes the close throw.
 */
export function mockChannelsClose(): void {
  class ChannelsFailure extends Error {
    readonly status: number;
    readonly code: string;
    readonly hash?: string;

    constructor(status: number, code: string, message: string, hash?: string) {
      super(message);
      this.name = 'ChannelsFailure';
      this.status = status;
      this.code = code;
      this.hash = hash;
    }
  }

  async function submitSettle(
    order: { orderId: string; basketHash: string; buyer: string },
    receiptHash: Uint8Array,
    deps: { resolver: { publicKey(): string } },
  ) {
    if (chain.fail) throw chain.fail;
    const signedBy = deps.resolver.publicKey();
    chain.calls.push({
      method: 'settle',
      args: { order: order.orderId, receipt: Buffer.from(receiptHash).toString('hex') },
      signedBy,
    });
    return { hash: `tx-settle-${chain.calls.length}`, feePayer: 'channels' as const };
  }

  async function submitRefund(
    order: { orderId: string; buyer: string },
    deps: { resolver: { publicKey(): string } },
  ) {
    if (chain.fail) throw chain.fail;
    const signedBy = deps.resolver.publicKey();
    chain.calls.push({
      method: 'refund',
      args: { order: order.orderId, caller: signedBy },
      signedBy,
    });
    return { hash: `tx-refund-${chain.calls.length}`, feePayer: 'channels' as const };
  }

  mock.module(new URL('../../server/channels.ts', import.meta.url).href, {
    namedExports: {
      ChannelsFailure,
      channelsKey: () => 'test-key',
      channelsClient: async () => ({
        submitSorobanTransaction: async () => ({ hash: 'ab'.repeat(32) }),
      }),
      stellarSimulator: () => ({
        simulate: async () => ({ auth: [] as string[], latestLedger: 1 }),
      }),
      noteLanded: async () => {},
      submitSettle,
      submitRefund,
    },
  });
}

export { EscrowClient, UsdcClient };
