/**
 * The bytes Freighter can sign, and the entry the network will check.
 *
 * `signAuthEntry` is handed a `HashIdPreimage`, not a `SorobanAuthorizationEntry`.
 * Freighter parses that preimage with an SDK that only knows the original
 * Soroban authorization envelope. Protocol 30 simulation records
 * `ADDRESS_V2`, whose preimage is the newer with-address envelope, and the
 * wallet reports it as an authorization entry it could not parse.
 *
 * So the shopper signs the original preimage — network id, nonce, invocation,
 * expiry, and not the address — and the entry we submit uses the original
 * address credentials. The host rebuilds that same preimage when it checks
 * the signature. A wallet that already returns a complete entry (the same
 * invocation, with a signature filled in) is passed through.
 */

import { Address, Keypair, hash, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk';

export class AuthEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthEntryError';
  }
}

function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials | null {
  const creds = entry.credentials;
  if (creds.type === 'sorobanCredentialsAddress') return creds.address;
  if (creds.type === 'sorobanCredentialsAddressV2') return creds.addressV2;
  return null;
}

function decodeEntry(entryXdr: string): xdr.SorobanAuthorizationEntry {
  try {
    return xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64');
  } catch {
    throw new AuthEntryError('La autorización no corresponde a este pago.');
  }
}

/** The V1 preimage, base64. This is what `signAuthEntry` is given. */
export function preimageForWallet(entryXdr: string, networkPassphrase: string): string {
  const entry = decodeEntry(entryXdr);
  const creds = addressCredentials(entry);
  if (!creds) throw new AuthEntryError('La autorización no corresponde a este pago.');
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(networkPassphrase),
      nonce: creds.nonce,
      invocation: entry.rootInvocation,
      signatureExpirationLedger: creds.signatureExpirationLedger,
    }),
  );
  return preimage.toXDR('base64');
}

function bytesFromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A wallet that returns the whole signed entry, for this same invocation.
 * Signature bytes do not parse as an entry, so those fall through.
 */
function completeEntry(entryXdr: string, returned: string): string | null {
  let got: xdr.SorobanAuthorizationEntry;
  try {
    got = xdr.SorobanAuthorizationEntry.fromXDR(returned, 'base64');
  } catch {
    return null;
  }
  const original = decodeEntry(entryXdr);
  if (got.rootInvocation.toXDR('base64') !== original.rootInvocation.toXDR('base64')) return null;
  const creds = addressCredentials(got);
  if (!creds || creds.signature.toXDR('base64') === xdr.ScVal.scvVoid().toXDR('base64')) return null;
  return returned;
}

function entryWithSignature(entryXdr: string, signatureB64: string, networkPassphrase: string): string {
  const entry = decodeEntry(entryXdr);
  const creds = addressCredentials(entry);
  if (!creds) throw new AuthEntryError('La autorización no corresponde a este pago.');
  const preimage = xdr.HashIdPreimage.fromXDR(preimageForWallet(entryXdr, networkPassphrase), 'base64');
  const payload = hash(preimage.toXDR());
  let signature: Uint8Array;
  try {
    signature = bytesFromBase64(signatureB64);
  } catch {
    throw new AuthEntryError('No se firmó el pago.');
  }
  if (signature.length !== 64) throw new AuthEntryError('No se firmó el pago.');
  const publicKey = Address.fromScAddress(creds.address).toString();
  if (!Keypair.fromPublicKey(publicKey).verify(payload, signature)) {
    throw new AuthEntryError('No se firmó el pago.');
  }
  const sigScVal = nativeToScVal(
    {
      public_key: StrKey.decodeEd25519PublicKey(publicKey),
      signature,
    },
    {
      type: {
        public_key: ['symbol', null],
        signature: ['symbol', null],
      },
    },
  );
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: creds.address,
        nonce: creds.nonce,
        signatureExpirationLedger: creds.signatureExpirationLedger,
        signature: xdr.ScVal.scvVec([sigScVal]),
      }),
    ),
    rootInvocation: entry.rootInvocation,
  }).toXDR('base64');
}

/**
 * The entry to submit. `signed` is either raw signature bytes or a finished
 * entry for the same invocation.
 */
export function walletAuthEntry(entryXdr: string, signed: string, networkPassphrase: string): string {
  const returned = signed.trim();
  if (!returned) throw new AuthEntryError('No se firmó el pago.');
  return completeEntry(entryXdr, returned) ?? entryWithSignature(entryXdr, returned, networkPassphrase);
}
