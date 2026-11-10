/**
 * OpenZeppelin Stellar Channels for `escrow.open` (issue #2).
 *
 * The buyer signs one authorization entry. A Channels account is the
 * transaction source and pays the fee. The browser never sends the host
 * function: this module rebuilds it from the quoted order and checks that
 * the signed entry is that call, for that buyer.
 *
 * The client is imported from the package's client file, not its root. The
 * root also loads a Node-only Actions plugin, which a Worker cannot run.
 */

import {
  Account,
  Address,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import { recoverOpenAttempt } from '../checkout/open-recovery.ts';
import { checkoutStore } from '../checkout/store.ts';
import { readOrder } from '../checkout/escrow-server.ts';
import { contractIds } from '../contract-ids.ts';
import { deployment, type NetworkId } from '../deployments.ts';
import { DEFAULT_TIMEOUT_SECS, MAX_TIMEOUT_SECS, MIN_TIMEOUT_SECS, fromHex } from '../order.ts';
import { rpcUrl } from '../rpc-url.ts';
import { rpcServer } from '../stellar.ts';

const CHANNELS_TESTNET = 'https://channels.openzeppelin.com/testnet';
const EXPIRY_LEDGERS = 60;
const SUBMIT_TRIES = 3;
const HASH_RE = /^[0-9a-f]{64}$/;

const EXECUTION_CODES = new Set([
  'FEE_LIMIT_EXCEEDED',
  'POOL_CAPACITY',
  'AUTH_EXPIRY_TOO_SHORT',
  'SIMULATION_FAILED',
  'SIMULATION_NETWORK_ERROR',
  'SIMULATION_RPC_FAILURE',
  'SIMULATION_SIGNED_AUTH_VALIDATION_FAILED',
  'WAIT_TIMEOUT',
  'ONCHAIN_FAILED',
]);

export interface OpenFields {
  orderId: string;
  amount: string;
  basketHash: string;
  timeoutSecs: number;
  contractId: string;
  method: string;
  network: string;
}

export interface PrepareOk {
  kind: 'sign';
  entries: string[];
  validUntilLedger: number;
  func: string;
}

export interface AlreadyOpen {
  kind: 'opened';
  hash: string;
}

/** Slim checkout row used by prepare/submit and the recovery path. */
export interface ChannelsRecord {
  orderId: string;
  buyer: string;
  amount: string;
  basketHash: string;
  openSig?: string;
  openAttemptSig?: string;
}

/** What deps may return; `orderId` is filled from the request when omitted. */
export type ChannelsRecordRow = Omit<ChannelsRecord, 'orderId'> & { orderId?: string };

export class ChannelsFailure extends Error {
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

export interface Simulator {
  simulate(funcXdr: string, source: string): Promise<{ auth: string[]; latestLedger: number }>;
}

export interface ChannelsSubmitter {
  submitSorobanTransaction(req: { func: string; auth: string[] }): Promise<{ hash?: string }>;
}

/** Quote fields compared to an on-chain order. */
export interface OpenedWant {
  orderId: string;
  buyer: string;
  amount: string;
  basketHash: string;
}

export interface ChannelsDeps {
  simulator: Simulator;
  client: ChannelsSubmitter | null;
  apiKey: string | undefined;
  sleep?: (ms: number) => Promise<void>;
  /** True when the chain holds an order matching buyer, amount and basket hash. */
  readOpened?: (want: OpenedWant) => Promise<boolean>;
  /**
   * Transaction hash of an `opened` event for this order. The default reads
   * it from RPC. Tests pass a stub so a unit test does not ask the network.
   */
  findOpenHash?: (want: OpenedWant) => Promise<string | null>;
  loadRecord?: (orderId: string) => Promise<ChannelsRecordRow | null>;
  saveAttempt?: (orderId: string, hash: string) => Promise<void>;
  recoverAttempt?: (rec: ChannelsRecord) => Promise<ChannelsRecord>;
  note?: (line: string) => void;
}

export function channelsKey(): string | undefined {
  const key = process.env.OZ_CHANNELS_API_KEY?.trim();
  return key ? key : undefined;
}

function hostOpen(escrowId: string, input: OpenFields & { buyer: string }): string {
  const amount = BigInt(input.amount);
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(escrowId).toScAddress(),
      functionName: 'open',
      args: [
        new Address(input.buyer).toScVal(),
        nativeToScVal(Buffer.from(fromHex(input.orderId)), { type: 'bytes' }),
        nativeToScVal(amount, { type: 'i128' }),
        nativeToScVal(Buffer.from(fromHex(input.basketHash)), { type: 'bytes' }),
        nativeToScVal(BigInt(input.timeoutSecs), { type: 'u64' }),
      ],
    }),
  );
  return func.toXDR('base64');
}

function assertOpenShape(input: OpenFields): void {
  if (input.method !== 'open') {
    throw new ChannelsFailure(400, 'channels_method', 'Solo se puede abrir un pedido.');
  }
  if (!/^[0-9a-f]{64}$/.test(input.orderId) || !/^[0-9a-f]{64}$/.test(input.basketHash)) {
    throw new ChannelsFailure(400, 'channels_ids', 'El pedido no es válido.');
  }
  if (!/^C[A-Z2-7]{55}$/.test(input.contractId)) {
    throw new ChannelsFailure(400, 'channels_contract', 'El contrato no es válido.');
  }
  if (!Number.isInteger(input.timeoutSecs) || input.timeoutSecs < MIN_TIMEOUT_SECS || input.timeoutSecs > MAX_TIMEOUT_SECS) {
    throw new ChannelsFailure(400, 'channels_timeout', 'El plazo no es válido.');
  }
}

export function buildOpenFuncForBuyer(input: OpenFields, buyer: string): string {
  assertOpenShape(input);
  if (input.network !== 'testnet') {
    throw new ChannelsFailure(403, 'channels_mainnet', 'Channels está disponible solo en testnet.');
  }
  const escrowId = contractIds('testnet').escrowId;
  if (input.contractId !== escrowId) {
    throw new ChannelsFailure(400, 'channels_contract', 'El contrato no es el de este entorno.');
  }
  if (!/^G[A-Z2-7]{55}$/.test(buyer)) {
    throw new ChannelsFailure(400, 'channels_buyer', 'La cuenta no es válida.');
  }
  let amount: bigint;
  try {
    amount = BigInt(input.amount);
  } catch {
    throw new ChannelsFailure(400, 'channels_amount', 'El monto no es válido.');
  }
  if (amount <= 0n) throw new ChannelsFailure(400, 'channels_amount', 'El monto no es válido.');
  return hostOpen(escrowId, { ...input, buyer, amount: amount.toString() });
}

/** The two RPC calls a simulation needs. Neither decodes a ledger header. */
export type SimulationRpc = Pick<rpc.Server, 'getAccount' | 'simulateTransaction'>;

/**
 * The live simulator. The source is the public resolver, never the buyer.
 *
 * Auth expiry counts from the ledger the simulation ran at. It does not call
 * `getLatestLedger`: SDK 17.1 cannot decode a protocol 30 ledger header, and
 * that throw failed every prepare on testnet while the simulation was fine.
 */
export function stellarSimulator(net: NetworkId, rpcOverride?: SimulationRpc): Simulator {
  return {
    async simulate(funcXdr: string, source: string) {
      const server = rpcOverride ?? rpcServer(net);
      const account = await server.getAccount(source);
      const tx = new TransactionBuilder(new Account(account.accountId(), account.sequenceNumber()), {
        fee: '100000',
        networkPassphrase: deployment(net).networkPassphrase,
      })
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.fromXDR(funcXdr, 'base64'),
          auth: [],
        }))
        .setTimeout(60)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        const code = simCode(sim.error);
        if (code === 'channels_sim') console.warn('[channels] simulation failed', firstLine(sim.error));
        throw new ChannelsFailure(409, code, simMessage(sim.error));
      }
      const auth = (sim.result?.auth ?? []).map((entry) => entry.toXDR('base64'));
      return { auth, latestLedger: sim.latestLedger };
    },
  };
}

/**
 * A failed simulation names a contract error, not a reason. The token's
 * transfer failing is reported by the escrow as `"contract call failed",
 * transfer`; mock USDC's #4 is InsufficientBalance. The escrow's own #3 is
 * OrderExists.
 */
const TRANSFER_FAILED = /Error\(Contract, #(\d+)\)\], data:\["contract call failed", transfer,/;
const ESCROW_ORDER_EXISTS = /^HostError: Error\(Contract, #3\)/;

function simCode(error: string): string {
  const transfer = TRANSFER_FAILED.exec(error);
  if (transfer?.[1] === '4') return 'channels_balance';
  if (!transfer && ESCROW_ORDER_EXISTS.test(error)) return 'channels_exists';
  const text = error.toLowerCase();
  if (text.includes('account') || text.includes('not found')) return 'channels_account';
  if (text.includes('balance') || text.includes('insufficient')) return 'channels_balance';
  return 'channels_sim';
}

function simMessage(error: string): string {
  const code = simCode(error);
  if (code === 'channels_account') return 'La cuenta todavía no existe en testnet.';
  if (code === 'channels_balance') return 'No alcanza el USDC para este pedido.';
  if (code === 'channels_exists') return 'Ese pedido ya está abierto.';
  return 'La red no pudo simular el pago.';
}

/** For the server log only: the host error's headline, not its event dump. */
function firstLine(text: string): string {
  return text.split('\n', 1)[0]!.slice(0, 200);
}

/**
 * The buyer's address credentials. Protocol 30 simulation records
 * `ADDRESS_V2`, which binds the address into the signed payload and carries
 * the same fields. Source-account and delegated credentials are refused: the
 * buyer is the one signer.
 */
function buyerCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials {
  const creds = entry.credentials;
  if (creds.type === 'sorobanCredentialsAddress') return creds.address;
  if (creds.type === 'sorobanCredentialsAddressV2') return creds.addressV2;
  throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
}

/** Rewrites the expiry and keeps the credential variant the network recorded. */
export function setAuthExpiry(entryXdr: string, ledger: number): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64');
  const address = buyerCredentials(entry);
  const renewed = new xdr.SorobanAddressCredentials({
    address: address.address,
    nonce: address.nonce,
    signatureExpirationLedger: ledger,
    signature: address.signature,
  });
  const next = new xdr.SorobanAuthorizationEntry({
    credentials: entry.credentials.type === 'sorobanCredentialsAddressV2'
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(renewed)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(renewed),
    rootInvocation: entry.rootInvocation,
  });
  return next.toXDR('base64');
}

export function assertBuyerEntries(entries: string[], buyer: string, funcXdr: string): void {
  if (entries.length !== 1) {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entries[0]!, 'base64');
  const address = Address.fromScAddress(buyerCredentials(entry).address).toString();
  if (address !== buyer) {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const fn = entry.rootInvocation.function;
  if (fn.type !== 'sorobanAuthorizedFunctionTypeContractFn') {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const want = xdr.HostFunction.fromXDR(funcXdr, 'base64');
  if (want.type !== 'hostFunctionTypeInvokeContract') {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  if (fn.contractFn.toXDR('base64') !== want.invokeContract.toXDR('base64')) {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const transfer = entry.rootInvocation.subInvocations.some((sub) => {
    const inner = sub.function;
    return inner.type === 'sorobanAuthorizedFunctionTypeContractFn'
      && String(inner.contractFn.functionName) === 'transfer';
  });
  if (!transfer) {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
}

function assertRecordMatch(rec: ChannelsRecord, input: OpenFields, buyer: string): void {
  if (rec.buyer !== buyer || rec.amount !== input.amount || rec.basketHash !== input.basketHash) {
    throw new ChannelsFailure(409, 'channels_record', 'El pedido no coincide con la cotización.');
  }
  if (input.timeoutSecs !== DEFAULT_TIMEOUT_SECS) {
    throw new ChannelsFailure(409, 'channels_record', 'El pedido no coincide con la cotización.');
  }
}

async function loadQuoted(
  orderId: string,
  deps: ChannelsDeps,
): Promise<ChannelsRecord | null> {
  const raw = await (deps.loadRecord ?? loadCheckout)(orderId);
  if (!raw) return null;
  const rec: ChannelsRecord = {
    orderId: raw.orderId || orderId,
    buyer: raw.buyer,
    amount: raw.amount,
    basketHash: raw.basketHash,
    openSig: raw.openSig,
    openAttemptSig: raw.openAttemptSig,
  };
  return deps.recoverAttempt ? deps.recoverAttempt(rec) : recoverCheckout(rec);
}

async function recoverCheckout(rec: ChannelsRecord): Promise<ChannelsRecord> {
  if (rec.openSig || !rec.openAttemptSig) return rec;
  const full = await checkoutStore().get(rec.orderId);
  if (full) {
    const next = await recoverOpenAttempt(full);
    return {
      orderId: next.orderId,
      buyer: next.buyer,
      amount: next.amount,
      basketHash: next.basketHash,
      openSig: next.openSig,
      openAttemptSig: next.openAttemptSig,
    };
  }
  const order = await readOrder(rec.orderId);
  if (!order || order.orderId !== rec.orderId || order.buyer !== rec.buyer
      || order.amount !== BigInt(rec.amount) || order.basketHash !== rec.basketHash) {
    return rec;
  }
  return { ...rec, openSig: rec.openAttemptSig };
}

function openedWant(input: OpenFields, buyer: string): OpenedWant {
  return {
    orderId: input.orderId,
    buyer,
    amount: input.amount,
    basketHash: input.basketHash,
  };
}

async function orderMatches(want: OpenedWant): Promise<boolean> {
  const order = await readOrder(want.orderId);
  return Boolean(
    order
    && order.orderId === want.orderId
    && order.buyer === want.buyer
    && order.amount === BigInt(want.amount)
    && order.basketHash === want.basketHash,
  );
}

async function isOpened(want: OpenedWant, deps: ChannelsDeps): Promise<boolean> {
  return (deps.readOpened ?? orderMatches)(want);
}

function confirming(hash?: string): ChannelsFailure {
  return new ChannelsFailure(
    409,
    'channels_confirming',
    'El pago puede haber entrado. No vuelvas a firmar.',
    hash,
  );
}

/**
 * The `opened` event for this order, read without decoding a ledger header.
 *
 * SDK 17.1 cannot parse a protocol 30 ledger entry, so `readOrder` often
 * cannot see an open that already locked the USDC. The event payload is a
 * plain ScVal. Its transaction hash is the open the checkout has to keep.
 */
async function openedTxHash(want: OpenedWant): Promise<string | null> {
  const url = rpcUrl('testnet');
  const escrowId = contractIds('testnet').escrowId;
  const latest = await rpcCall(url, 'getLatestLedger', {});
  const sequence = typeof latest.sequence === 'number' ? latest.sequence : 0;
  if (!sequence) return null;
  const result = await rpcCall(url, 'getEvents', {
    startLedger: Math.max(1, sequence - 2_000),
    filters: [{
      type: 'contract',
      contractIds: [escrowId],
      topics: [[
        xdr.ScVal.scvSymbol('opened').toXDR('base64'),
        nativeToScVal(Buffer.from(fromHex(want.orderId)), { type: 'bytes' }).toXDR('base64'),
        new Address(want.buyer).toScVal().toXDR('base64'),
      ]],
    }],
    pagination: { limit: 5 },
  });
  const events = Array.isArray(result.events) ? result.events : [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const row = ev as { txHash?: unknown; value?: unknown };
    const hash = typeof row.txHash === 'string' ? row.txHash.trim().toLowerCase() : '';
    if (!HASH_RE.test(hash) || typeof row.value !== 'string') continue;
    const value = scValToNative(xdr.ScVal.fromXDR(row.value, 'base64')) as {
      amount?: bigint;
      basket_hash?: Uint8Array;
    };
    const basket = value.basket_hash ? Buffer.from(value.basket_hash).toString('hex') : '';
    if (value.amount?.toString() === want.amount && basket === want.basketHash) return hash;
  }
  return null;
}

async function rpcCall(url: string, method: string, params: unknown): Promise<{ [key: string]: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json() as { result?: { [key: string]: unknown }; error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? 'rpc');
  return json.result ?? {};
}

async function hashOnChain(want: OpenedWant, deps: ChannelsDeps): Promise<string | null> {
  try {
    const hash = await (deps.findOpenHash ?? openedTxHash)(want);
    return hash && HASH_RE.test(hash) ? hash : null;
  } catch (err) {
    console.warn('[channels] opened lookup', err instanceof Error ? err.name : 'failed');
    return null;
  }
}

/**
 * A matching on-chain order is never a retryable failure.
 * Returns the known hash, or throws channels_confirming when the hash is unknown.
 */
async function settleFromChain(
  want: OpenedWant,
  deps: ChannelsDeps,
  candidateHash?: string,
): Promise<{ hash: string } | null> {
  const fromEvent = await hashOnChain(want, deps);
  if (fromEvent) return { hash: fromEvent };
  if (!(await isOpened(want, deps))) return null;
  const rec = await loadQuoted(want.orderId, deps);
  if (rec?.openSig && HASH_RE.test(rec.openSig)) return { hash: rec.openSig };
  const fromAttempt = rec?.openAttemptSig && HASH_RE.test(rec.openAttemptSig)
    ? rec.openAttemptSig
    : undefined;
  const fromCandidate = candidateHash && HASH_RE.test(candidateHash) ? candidateHash : undefined;
  const hash = fromAttempt ?? fromCandidate;
  if (hash) return { hash };
  throw confirming();
}

export async function prepareOpen(
  input: OpenFields,
  buyer: string,
  deps: ChannelsDeps,
): Promise<PrepareOk | AlreadyOpen> {
  if (!deps.apiKey) {
    throw new ChannelsFailure(503, 'channels_unconfigured', 'Los pagos no están habilitados.');
  }
  const func = buildOpenFuncForBuyer(input, buyer);
  const want = openedWant(input, buyer);
  const rec = await loadQuoted(input.orderId, deps);
  if (rec) {
    assertRecordMatch(rec, input, buyer);
    if (rec.openSig && HASH_RE.test(rec.openSig)) {
      return { kind: 'opened', hash: rec.openSig };
    }
    if (rec.openAttemptSig && HASH_RE.test(rec.openAttemptSig)) {
      const fromEvent = await hashOnChain(want, deps);
      if (fromEvent) return { kind: 'opened', hash: fromEvent };
      throw confirming(rec.openAttemptSig);
    }
  }
  const settled = await settleFromChain(want, deps);
  if (settled) return { kind: 'opened', hash: settled.hash };
  const source = deployment('testnet').resolver;
  let sim: { auth: string[]; latestLedger: number };
  try {
    sim = await deps.simulator.simulate(func, source);
  } catch (err) {
    if (err instanceof ChannelsFailure) throw err;
    // Not a simulation result: the RPC call or its decoding threw. A code of
    // its own keeps it apart from a simulation that ran and failed.
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? firstLine(err.message) : '';
    console.warn('[channels] simulate threw', name, message);
    throw new ChannelsFailure(502, 'channels_rpc', 'La red no pudo simular el pago.');
  }
  const ledger = sim.latestLedger + EXPIRY_LEDGERS;
  const entries = sim.auth.map((entry) => setAuthExpiry(entry, ledger));
  assertBuyerEntries(entries, buyer, func);
  return { kind: 'sign', entries, validUntilLedger: ledger, func };
}

export async function submitOpen(
  input: OpenFields,
  buyer: string,
  signed: string[],
  deps: ChannelsDeps,
): Promise<{ hash: string }> {
  if (!deps.apiKey || !deps.client) {
    throw new ChannelsFailure(503, 'channels_unconfigured', 'Los pagos no están habilitados.');
  }
  const func = buildOpenFuncForBuyer(input, buyer);
  const want = openedWant(input, buyer);
  const rec = await loadQuoted(input.orderId, deps);
  if (rec) {
    assertRecordMatch(rec, input, buyer);
    if (rec.openSig && HASH_RE.test(rec.openSig)) {
      return { hash: rec.openSig };
    }
    if (rec.openAttemptSig && HASH_RE.test(rec.openAttemptSig)) {
      const fromEvent = await hashOnChain(want, deps);
      if (fromEvent) return { hash: fromEvent };
      throw confirming(rec.openAttemptSig);
    }
  }
  assertBuyerEntries(signed, buyer, func);
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: ChannelsFailure | null = null;
  for (let attempt = 0; attempt < SUBMIT_TRIES; attempt++) {
    try {
      const sent = await deps.client.submitSorobanTransaction({ func, auth: signed });
      const hash = sent.hash?.trim().toLowerCase();
      if (!hash || !HASH_RE.test(hash)) {
        throw new ChannelsFailure(502, 'channels_submit', 'No se pudo enviar el pago.');
      }
      await rememberAttempt(input.orderId, hash, deps);
      deps.note?.(`[channels] submitted ${hash}`);
      return { hash };
    } catch (err) {
      const mapped = err instanceof ChannelsFailure ? err : mapChannelsError(err);
      last = mapped;
      if (mapped.code === 'channels_pool' && attempt < SUBMIT_TRIES - 1) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      // WAIT_TIMEOUT may still land — keep a real hash. Never store an ONCHAIN_FAILED hash.
      const waitHash = mapped.code === 'channels_wait' ? mapped.hash : undefined;
      if (waitHash) await rememberAttempt(input.orderId, waitHash, deps);
      const settled = await settleFromChain(want, deps, waitHash);
      if (settled) return settled;
      if (mapped.code === 'channels_wait') throw confirming(waitHash);
      throw mapped;
    }
  }
  const settled = await settleFromChain(want, deps);
  if (settled) return settled;
  throw last ?? new ChannelsFailure(503, 'channels_pool', 'No se pudo enviar el pago. Probá de nuevo en un momento.');
}

async function rememberAttempt(orderId: string, hash: string, deps: ChannelsDeps): Promise<void> {
  try {
    await (deps.saveAttempt ?? saveOpenAttempt)(orderId, hash);
  } catch (err) {
    console.warn('[channels] attempt not stored', err instanceof Error ? err.name : 'failed');
  }
}

async function loadCheckout(orderId: string): Promise<ChannelsRecord | null> {
  const rec = await checkoutStore().get(orderId);
  if (!rec) return null;
  return {
    orderId: rec.orderId,
    buyer: rec.buyer,
    amount: rec.amount,
    basketHash: rec.basketHash,
    openSig: rec.openSig,
    openAttemptSig: rec.openAttemptSig,
  };
}

async function saveOpenAttempt(orderId: string, hash: string): Promise<void> {
  const rec = await checkoutStore().get(orderId);
  if (!rec || rec.openSig) return;
  rec.openAttemptSig = hash;
  await checkoutStore().set(rec);
}

interface ChannelsErrorBody {
  message?: string;
  category?: string;
  statusCode?: number;
  errorDetails?: {
    code?: string;
    status?: number;
    details?: unknown;
  } | unknown;
}

function asBody(err: unknown): ChannelsErrorBody {
  if (!err || typeof err !== 'object') return { message: String(err ?? '') };
  return err as ChannelsErrorBody;
}

function executionCode(body: ChannelsErrorBody): string | undefined {
  const details = body.errorDetails;
  if (details && typeof details === 'object' && typeof (details as { code?: unknown }).code === 'string') {
    return (details as { code: string }).code;
  }
  const message = body.message ?? '';
  if (EXECUTION_CODES.has(message)) return message;
  return undefined;
}

function executionDetails(body: ChannelsErrorBody): unknown {
  const details = body.errorDetails;
  if (!details || typeof details !== 'object') return undefined;
  return (details as { details?: unknown }).details;
}

function detailHash(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const hash = (details as { hash?: unknown }).hash;
  if (typeof hash !== 'string') return undefined;
  const normalized = hash.trim().toLowerCase();
  return HASH_RE.test(normalized) ? normalized : undefined;
}

/** Plugin shapes: SIMULATION_FAILED `{ error }`, ONCHAIN_FAILED `{ reason, resultCode }`. */
function detailMessage(details: unknown): string {
  if (typeof details === 'string') return details;
  if (!details || typeof details !== 'object') return '';
  const body = details as {
    error?: unknown;
    reason?: unknown;
    resultCode?: unknown;
    message?: unknown;
  };
  for (const value of [body.error, body.reason, body.resultCode, body.message]) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function mapSimFailed(details: unknown): ChannelsFailure {
  const text = detailMessage(details).toLowerCase();
  if (text.includes('orderexists')) {
    return new ChannelsFailure(409, 'channels_exists', 'Ese pedido ya está abierto.', detailHash(details));
  }
  if (text.includes('balance') || text.includes('insufficient')) {
    return new ChannelsFailure(409, 'channels_balance', 'No alcanza el USDC para este pedido.');
  }
  if (text.includes('account') || text.includes('not found')) {
    return new ChannelsFailure(409, 'channels_account', 'La cuenta todavía no existe en testnet.');
  }
  return new ChannelsFailure(409, 'channels_sim', 'La red no pudo simular el pago.');
}

function mapOnchainFailed(details: unknown): ChannelsFailure {
  return new ChannelsFailure(
    409,
    'channels_onchain',
    'No se pudo abrir el pedido en la red.',
    detailHash(details),
  );
}

export function mapChannelsError(err: unknown): ChannelsFailure {
  const body = asBody(err);
  if (body.category === 'transport') {
    return new ChannelsFailure(503, 'channels_pool', 'No se pudo enviar el pago. Probá de nuevo en un momento.');
  }
  const code = executionCode(body);
  const details = executionDetails(body);
  switch (code) {
    case 'FEE_LIMIT_EXCEEDED':
      return new ChannelsFailure(503, 'channels_fee_cap', 'El cupo de comisiones de hoy se agotó. Probá más tarde.');
    case 'WAIT_TIMEOUT':
      return new ChannelsFailure(
        409,
        'channels_wait',
        'El pago puede haber entrado. No vuelvas a firmar.',
        detailHash(details),
      );
    case 'POOL_CAPACITY':
    case 'SIMULATION_NETWORK_ERROR':
    case 'SIMULATION_RPC_FAILURE':
      return new ChannelsFailure(503, 'channels_pool', 'No se pudo enviar el pago. Probá de nuevo en un momento.');
    case 'AUTH_EXPIRY_TOO_SHORT':
      return new ChannelsFailure(409, 'channels_auth_expiry', 'La autorización venció. Volvé a firmar.');
    case 'SIMULATION_SIGNED_AUTH_VALIDATION_FAILED':
      return new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
    case 'SIMULATION_FAILED':
      return mapSimFailed(details);
    case 'ONCHAIN_FAILED':
      return mapOnchainFailed(details);
    default:
      return new ChannelsFailure(502, 'channels_submit', 'No se pudo enviar el pago.');
  }
}

/** Loads the Channels client. Returns null when the secret is unset. */
export async function channelsClient(): Promise<ChannelsSubmitter | null> {
  const apiKey = channelsKey();
  if (!apiKey) return null;
  const mod = await import('@openzeppelin/relayer-plugin-channels/dist/client/index.js') as {
    ChannelsClient: new (config: { baseUrl: string; apiKey: string }) => ChannelsSubmitter;
  };
  return new mod.ChannelsClient({ baseUrl: CHANNELS_TESTNET, apiKey });
}

export async function noteLanded(hash: string, net: NetworkId = 'testnet'): Promise<void> {
  try {
    const got = await rpcServer(net).getTransaction(hash);
    if (got.status !== 'SUCCESS' || !('envelopeXdr' in got)) {
      console.info('[channels] submitted', hash);
      return;
    }
    const tx = TransactionBuilder.fromXDR(got.envelopeXdr, deployment(net).networkPassphrase) as {
      source?: string;
      feeSource?: string;
      innerTransaction?: { source?: string };
    };
    const feeSource = tx.feeSource ?? tx.source ?? '';
    const source = tx.innerTransaction?.source ?? tx.source ?? '';
    console.info('[channels] submitted', hash, source, feeSource);
  } catch {
    console.info('[channels] submitted', hash);
  }
}
