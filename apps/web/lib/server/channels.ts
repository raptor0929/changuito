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
  xdr,
} from '@stellar/stellar-sdk';

import { checkoutStore } from '../checkout/store.ts';
import { readOrder } from '../checkout/escrow-server.ts';
import { contractIds } from '../contract-ids.ts';
import { deployment, type NetworkId } from '../deployments.ts';
import { DEFAULT_TIMEOUT_SECS, fromHex } from '../order.ts';
import { rpcServer } from '../stellar.ts';

const CHANNELS_TESTNET = 'https://channels.openzeppelin.com/testnet';
const EXPIRY_LEDGERS = 60;
const SUBMIT_TRIES = 3;

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

export class ChannelsFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChannelsFailure';
    this.status = status;
    this.code = code;
  }
}

export interface Simulator {
  simulate(funcXdr: string, source: string): Promise<{ auth: string[]; latestLedger: number }>;
}

export interface ChannelsSubmitter {
  submitSorobanTransaction(req: { func: string; auth: string[] }): Promise<{ hash?: string }>;
}

export interface ChannelsDeps {
  simulator: Simulator;
  client: ChannelsSubmitter | null;
  apiKey: string | undefined;
  sleep?: (ms: number) => Promise<void>;
  readOpened?: (orderId: string) => Promise<boolean>;
  loadRecord?: (orderId: string) => Promise<{ buyer: string; amount: string; basketHash: string; openSig?: string } | null>;
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
  if (!Number.isInteger(input.timeoutSecs)) {
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

/** The live simulator. The source is the public resolver, never the buyer. */
export function stellarSimulator(net: NetworkId): Simulator {
  return {
    async simulate(funcXdr: string, source: string) {
      const server = rpcServer(net);
      const account = await server.getAccount(source);
      const latest = await server.getLatestLedger();
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
        throw new ChannelsFailure(409, simCode(sim.error), simMessage(sim.error));
      }
      const auth = (sim.result?.auth ?? []).map((entry) => entry.toXDR('base64'));
      return { auth, latestLedger: latest.sequence };
    },
  };
}

function simCode(error: string): string {
  const text = error.toLowerCase();
  if (text.includes('account') || text.includes('not found')) return 'channels_account';
  if (text.includes('balance') || text.includes('insufficient')) return 'channels_balance';
  return 'channels_sim';
}

function simMessage(error: string): string {
  const code = simCode(error);
  if (code === 'channels_account') return 'La cuenta todavía no existe en testnet.';
  if (code === 'channels_balance') return 'No alcanza el USDC para este pedido.';
  return 'La red no pudo simular el pago.';
}

export function setAuthExpiry(entryXdr: string, ledger: number): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64');
  const creds = entry.credentials;
  if (creds.type !== 'sorobanCredentialsAddress') {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const address = creds.address;
  const next = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: address.address,
      nonce: address.nonce,
      signatureExpirationLedger: ledger,
      signature: address.signature,
    })),
    rootInvocation: entry.rootInvocation,
  });
  return next.toXDR('base64');
}

export function assertBuyerEntries(entries: string[], buyer: string, funcXdr: string): void {
  if (entries.length !== 1) {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entries[0]!, 'base64');
  const creds = entry.credentials;
  if (creds.type !== 'sorobanCredentialsAddress') {
    throw new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  const address = Address.fromScAddress(creds.address.address).toString();
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

export async function prepareOpen(
  input: OpenFields,
  buyer: string,
  deps: ChannelsDeps,
): Promise<PrepareOk | AlreadyOpen> {
  if (!deps.apiKey) {
    throw new ChannelsFailure(503, 'channels_unconfigured', 'Los pagos no están habilitados.');
  }
  const func = buildOpenFuncForBuyer(input, buyer);
  const rec = await (deps.loadRecord ?? loadCheckout)(input.orderId);
  if (rec) {
    if (rec.buyer !== buyer || rec.amount !== input.amount || rec.basketHash !== input.basketHash) {
      throw new ChannelsFailure(409, 'channels_record', 'El pedido no coincide con la cotización.');
    }
    if (input.timeoutSecs !== DEFAULT_TIMEOUT_SECS) {
      throw new ChannelsFailure(409, 'channels_record', 'El pedido no coincide con la cotización.');
    }
    if (rec.openSig && /^[0-9a-f]{64}$/.test(rec.openSig)) {
      return { kind: 'opened', hash: rec.openSig };
    }
  }
  const source = deployment('testnet').resolver;
  let sim: { auth: string[]; latestLedger: number };
  try {
    sim = await deps.simulator.simulate(func, source);
  } catch (err) {
    if (err instanceof ChannelsFailure) throw err;
    throw new ChannelsFailure(502, 'channels_sim', 'La red no pudo simular el pago.');
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
  assertBuyerEntries(signed, buyer, func);
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: ChannelsFailure | null = null;
  for (let attempt = 0; attempt < SUBMIT_TRIES; attempt++) {
    try {
      const sent = await deps.client.submitSorobanTransaction({ func, auth: signed });
      const hash = sent.hash?.trim().toLowerCase();
      if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
        throw new ChannelsFailure(502, 'channels_submit', 'No se pudo enviar el pago.');
      }
      deps.note?.(`[channels] submitted ${hash}`);
      return { hash };
    } catch (err) {
      const mapped = err instanceof ChannelsFailure ? err : mapChannelsError(err);
      last = mapped;
      if (mapped.code === 'channels_pool' && attempt < SUBMIT_TRIES - 1) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      if (mapped.code === 'channels_wait' || mapped.code === 'channels_exists') {
        const opened = await (deps.readOpened ?? readOrderOpened)(input.orderId);
        if (opened) {
          throw new ChannelsFailure(409, 'channels_confirming', 'El pago puede haber entrado. No vuelvas a firmar.');
        }
      }
      throw mapped;
    }
  }
  throw last ?? new ChannelsFailure(503, 'channels_pool', 'No se pudo enviar el pago. Probá de nuevo en un momento.');
}

async function loadCheckout(orderId: string) {
  return checkoutStore().get(orderId);
}

async function readOrderOpened(orderId: string): Promise<boolean> {
  const found = await readOrder(orderId);
  return Boolean(found);
}

export function mapChannelsError(err: unknown): ChannelsFailure {
  const text = detailText(err);
  if (text.includes('FEE_LIMIT_EXCEEDED')) {
    return new ChannelsFailure(503, 'channels_fee_cap', 'El cupo de comisiones de hoy se agotó. Probá más tarde.');
  }
  if (text.includes('WAIT_TIMEOUT')) {
    return new ChannelsFailure(409, 'channels_wait', 'El pago puede haber entrado. No vuelvas a firmar.');
  }
  if (text.includes('POOL_CAPACITY') || text.includes('ECONN') || text.includes('ETIMEDOUT') || text.includes('502')) {
    return new ChannelsFailure(503, 'channels_pool', 'No se pudo enviar el pago. Probá de nuevo en un momento.');
  }
  if (text.includes('AUTH_EXPIRY_TOO_SHORT')) {
    return new ChannelsFailure(409, 'channels_auth_expiry', 'La autorización venció. Volvé a firmar.');
  }
  if (text.includes('SIMULATION_SIGNED_AUTH_VALIDATION_FAILED')) {
    return new ChannelsFailure(400, 'channels_auth', 'La autorización no corresponde a este pago.');
  }
  if (text.includes('account') && text.includes('SIMULATION_FAILED')) {
    return new ChannelsFailure(409, 'channels_account', 'La cuenta todavía no existe en testnet.');
  }
  if (text.includes('SIMULATION_FAILED')) {
    return new ChannelsFailure(409, 'channels_balance', 'No alcanza el USDC para este pedido.');
  }
  if (text.includes('OrderExists') || text.includes('ONCHAIN_FAILED')) {
    return new ChannelsFailure(409, 'channels_exists', 'Ese pedido ya está abierto.');
  }
  return new ChannelsFailure(502, 'channels_submit', 'No se pudo enviar el pago.');
}

function detailText(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err ?? '');
  const body = err as { message?: string; errorDetails?: unknown; statusCode?: number };
  const details = body.errorDetails == null
    ? ''
    : typeof body.errorDetails === 'string' ? body.errorDetails : JSON.stringify(body.errorDetails);
  return `${body.message ?? ''} ${details}`;
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
