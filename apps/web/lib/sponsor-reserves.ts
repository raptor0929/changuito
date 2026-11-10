/**
 * Classic sponsored account + USDC trustline (issue #6).
 *
 * One transaction, source = Changuito's sponsor:
 *   1. beginSponsoringFutureReserves(user)   — sponsor
 *   2. createAccount(user, "0")              — sponsor, only when missing
 *   3. changeTrust(USDC:GBBD47…)             — user
 *   4. endSponsoringFutureReserves           — user
 *
 * The shopper co-signs in Freighter; the sponsor submits and pays the fee.
 * Channels only accepts Soroban host functions, so classic sponsorship goes
 * through Horizon with the sponsor account — never the buyer.
 *
 * The trustline asset is Circle's classic testnet USDC, named by the issue.
 * It is not the mock Soroban token the escrow holds, and it is not the
 * demo-asset issuer on the deposit rail.
 */
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { DEPLOYMENTS, type NetworkId } from './deployments.ts';
import { hasTrustline, type AccountBalance } from './stellar.ts';

/** Circle testnet USDC issuer — the classic asset the issue names. */
export const CIRCLE_TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const CIRCLE_TESTNET_USDC_CODE = 'USDC';

export function sponsoredUsdcAsset(): Asset {
  return new Asset(CIRCLE_TESTNET_USDC_CODE, CIRCLE_TESTNET_USDC_ISSUER);
}

export type SponsorNeed = 'create-and-trust' | 'trust-only' | 'ready';

/**
 * What the sponsor still has to do for this account, from Horizon balances.
 * `null` balances means the account is not on the ledger.
 */
export function sponsorNeed(balances: AccountBalance[] | null): SponsorNeed {
  if (balances === null) return 'create-and-trust';
  if (hasTrustline(balances, CIRCLE_TESTNET_USDC_CODE, CIRCLE_TESTNET_USDC_ISSUER)) return 'ready';
  return 'trust-only';
}

export interface SponsorBuildInput {
  sponsorPublicKey: string;
  /** Sponsor sequence as Horizon reports it (before this tx consumes one). */
  sponsorSequence: string;
  userPublicKey: string;
  need: Exclude<SponsorNeed, 'ready'>;
  network: NetworkId;
  /** Seconds until the envelope expires. */
  timeoutSecs?: number;
  fee?: string;
}

export interface SponsorOpSummary {
  type: string;
  source: string | undefined;
  /** Present on createAccount — always the sponsored user. */
  destination?: string;
  /** Present on createAccount; normalised to `"0"`. */
  startingBalance?: string;
  /** Present on changeTrust. */
  asset?: { code: string; issuer: string };
  /** Present on beginSponsoringFutureReserves. */
  sponsoredId?: string;
}

/**
 * The operation list the envelope must carry. Pure: no network, no signing.
 * Tests pin this shape so a drift in the route is a failed assertion, not a
 * surprise on Freighter.
 */
function sponsorOperationXdr(input: {
  userPublicKey: string;
  need: Exclude<SponsorNeed, 'ready'>;
}): ReturnType<typeof Operation.beginSponsoringFutureReserves>[] {
  const usdc = sponsoredUsdcAsset();
  const ops: ReturnType<typeof Operation.beginSponsoringFutureReserves>[] = [
    Operation.beginSponsoringFutureReserves({ sponsoredId: input.userPublicKey }),
  ];
  if (input.need === 'create-and-trust') {
    ops.push(
      Operation.createAccount({
        destination: input.userPublicKey,
        startingBalance: '0',
      }),
    );
  }
  ops.push(
    Operation.changeTrust({ asset: usdc, source: input.userPublicKey }),
    Operation.endSponsoringFutureReserves({ source: input.userPublicKey }),
  );
  return ops;
}

/**
 * The expected envelope shape as plain data. Operation.* returns XDR bodies
 * without the attribute `type` until they sit on a Transaction, so tests and
 * submit checks compare against this rather than the raw XDR ops.
 */
export function expectedSponsorOps(input: {
  userPublicKey: string;
  need: Exclude<SponsorNeed, 'ready'>;
}): SponsorOpSummary[] {
  const ops: SponsorOpSummary[] = [
    {
      type: 'beginSponsoringFutureReserves',
      source: undefined,
      sponsoredId: input.userPublicKey,
    },
  ];
  if (input.need === 'create-and-trust') {
    ops.push({
      type: 'createAccount',
      source: undefined,
      destination: input.userPublicKey,
      startingBalance: '0',
    });
  }
  ops.push(
    {
      type: 'changeTrust',
      source: input.userPublicKey,
      asset: { code: CIRCLE_TESTNET_USDC_CODE, issuer: CIRCLE_TESTNET_USDC_ISSUER },
    },
    { type: 'endSponsoringFutureReserves', source: input.userPublicKey },
  );
  return ops;
}

/** Summaries from a built Transaction's operations. */
export function summarizeSponsorOps(ops: ReadonlyArray<{ type: string; source?: string }>): SponsorOpSummary[] {
  return ops.map((op) => {
    const row = op as {
      type: string;
      source?: string;
      startingBalance?: string;
      destination?: string;
      line?: Asset;
      sponsoredId?: string;
    };
    const base: SponsorOpSummary = { type: row.type, source: row.source };
    if (row.type === 'createAccount') {
      // Horizon / the SDK expand `"0"` to `"0.0000000"` once the op is in an
      // envelope; pin the semantic value so prepare and submit agree.
      const raw = String(row.startingBalance ?? '');
      const startingBalance = Number(raw) === 0 ? '0' : raw;
      return { ...base, destination: String(row.destination ?? ''), startingBalance };
    }
    if (row.type === 'changeTrust') {
      const asset = row.line;
      if (asset instanceof Asset && !asset.isNative()) {
        const issuer = asset.getIssuer();
        if (!issuer) return base;
        return {
          ...base,
          asset: { code: asset.getCode(), issuer },
        };
      }
      return base;
    }
    if (row.type === 'beginSponsoringFutureReserves') {
      return { ...base, sponsoredId: String(row.sponsoredId ?? '') };
    }
    return base;
  });
}

/**
 * Build the envelope and sign it as the sponsor. The shopper still has to
 * co-sign changeTrust + endSponsoring before submit.
 */
export function buildSponsorTransaction(
  input: SponsorBuildInput,
  sponsor: Keypair,
): Transaction {
  if (sponsor.publicKey() !== input.sponsorPublicKey) {
    throw new Error('sponsor key does not match the declared public key');
  }
  const source = new Account(input.sponsorPublicKey, input.sponsorSequence);
  const builder = new TransactionBuilder(source, {
    fee: input.fee ?? BASE_FEE,
    networkPassphrase: DEPLOYMENTS[input.network].networkPassphrase,
  });
  for (const op of sponsorOperationXdr({ userPublicKey: input.userPublicKey, need: input.need })) {
    builder.addOperation(op);
  }
  const tx = builder.setTimeout(input.timeoutSecs ?? 180).build();
  tx.sign(sponsor);
  return tx;
}

/**
 * Confirm a shopper-signed envelope is still the sponsorship we built for
 * this user, with both signatures present, before paying the fee to submit.
 */
export function assertSponsoredEnvelope(args: {
  xdr: string;
  network: NetworkId;
  sponsorPublicKey: string;
  userPublicKey: string;
  need: Exclude<SponsorNeed, 'ready'>;
}): Transaction {
  const passphrase = DEPLOYMENTS[args.network].networkPassphrase;
  let tx: Transaction;
  try {
    tx = new Transaction(args.xdr, passphrase);
  } catch {
    throw new SponsorTxError(400, 'sponsor_xdr', 'La transacción firmada no es válida.');
  }
  if (tx.source !== args.sponsorPublicKey) {
    throw new SponsorTxError(400, 'sponsor_source', 'La transacción no es del sponsor de Changuito.');
  }
  const expected = expectedSponsorOps({ userPublicKey: args.userPublicKey, need: args.need });
  const got = summarizeSponsorOps(tx.operations);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new SponsorTxError(400, 'sponsor_ops', 'La transacción no coincide con el sponsorship pedido.');
  }
  if (tx.signatures.length < 2) {
    throw new SponsorTxError(400, 'sponsor_sigs', 'Falta la firma del comprador o del sponsor.');
  }
  const hash = tx.hash();
  const sponsorKp = Keypair.fromPublicKey(args.sponsorPublicKey);
  const userKp = Keypair.fromPublicKey(args.userPublicKey);
  let sponsorOk = false;
  let userOk = false;
  for (const sig of tx.signatures) {
    const bytes = signatureBytes(sig);
    if (sponsorKp.verify(hash, bytes)) sponsorOk = true;
    if (userKp.verify(hash, bytes)) userOk = true;
  }
  if (!sponsorOk || !userOk) {
    throw new SponsorTxError(400, 'sponsor_sigs', 'Falta la firma del comprador o del sponsor.');
  }
  return tx;
}

/** SDK 17 exposes DecoratedSignature fields as `{ value }`, not methods. */
function signatureBytes(sig: { signature: unknown }): Buffer {
  const raw = sig.signature as { value?: Uint8Array } | Uint8Array | (() => Uint8Array);
  if (typeof raw === 'function') return Buffer.from(raw());
  if (raw && typeof raw === 'object' && 'value' in raw && raw.value) return Buffer.from(raw.value);
  return Buffer.from(raw as Uint8Array);
}

export class SponsorTxError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SponsorTxError';
    this.status = status;
    this.code = code;
  }
}
