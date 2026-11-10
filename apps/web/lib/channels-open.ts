/**
 * Browser half of an escrow open through Channels.
 *
 * Asks the server to simulate, asks the wallet to sign each auth entry, then
 * asks the server to submit. The server rebuilds the call; this file never
 * sends a host function.
 *
 * A wallet answers in one of two ways. It returns the entry signed, or it
 * signs the entry's payload and returns the signature alone. The second kind
 * goes back as the prepared entry with the signature beside it, and the
 * server joins them.
 */

import { track } from './analytics';
import { OpenConfirmationPending } from './checkout/open-submission.ts';

export interface ChannelSigner {
  signAuthEntry(
    entryXdr: string,
    options: { validUntilLedger: number; payload?: string },
  ): Promise<
    | { status: 'signed'; signedAuthEntry: string }
    | { status: 'signature'; signature: string }
    | { status: 'error'; details?: string }
  >;
}

export interface ChannelOpen {
  network: string;
  contractId: string;
  method: 'open';
  orderId: string;
  amount: string;
  basketHash: string;
  timeoutSecs: number;
  signAuthEntry: ChannelSigner['signAuthEntry'];
}

export async function openThroughChannels(input: ChannelOpen): Promise<string> {
  const body = {
    network: input.network,
    contractId: input.contractId,
    method: input.method,
    orderId: input.orderId,
    amount: input.amount,
    basketHash: input.basketHash,
    timeoutSecs: input.timeoutSecs,
  };
  try {
    const first = await post({ ...body, step: 'prepare' });
    if (typeof first.hash === 'string') return first.hash;
    const hash = await signAndSubmit(body, first, input.signAuthEntry);
    return hash;
  } catch (err) {
    if (err instanceof OpenConfirmationPending) throw err;
    const code = err instanceof ChannelRequestError ? err.code : 'channels_submit';
    track('payment_fail', { flow: 'checkout', code });
    throw err;
  }
}

async function signAndSubmit(
  body: Record<string, unknown>,
  prepared: ChannelResponse,
  signAuthEntry: ChannelOpen['signAuthEntry'],
  renewed = false,
): Promise<string> {
  const entries = prepared.entries ?? [];
  const validUntilLedger = prepared.validUntilLedger;
  if (!entries.length || typeof validUntilLedger !== 'number') {
    throw new ChannelRequestError(502, 'channels_sim', 'La red no pudo simular el pago.');
  }
  const auth: string[] = [];
  const signatures: (string | null)[] = [];
  for (const [i, entry] of entries.entries()) {
    const signed = await signAuthEntry(entry, { validUntilLedger, payload: prepared.payloads?.[i] });
    if (signed.status === 'error') {
      throw new ChannelRequestError(400, 'channels_rejected', signed.details || 'No se firmó el pago.');
    }
    auth.push(signed.status === 'signature' ? entry : signed.signedAuthEntry);
    signatures.push(signed.status === 'signature' ? signed.signature : null);
  }
  try {
    const sent = await post({ ...body, step: 'submit', auth, signatures });
    if (typeof sent.hash !== 'string') throw new ChannelRequestError(502, 'channels_submit', 'No se pudo enviar el pago.');
    return sent.hash;
  } catch (err) {
    if (err instanceof ChannelRequestError && err.code === 'channels_auth_expiry' && !renewed) {
      const again = await post({ ...body, step: 'prepare' });
      if (typeof again.hash === 'string') return again.hash;
      return signAndSubmit(body, again, signAuthEntry, true);
    }
    throw err;
  }
}

interface ChannelResponse {
  hash?: string;
  entries?: string[];
  payloads?: string[];
  validUntilLedger?: number;
  error?: string;
  code?: string;
}

class ChannelRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChannelRequestError';
    this.status = status;
    this.code = code;
  }
}

async function post(body: Record<string, unknown>): Promise<ChannelResponse> {
  const res = await fetch('/api/checkout/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({})) as ChannelResponse;
  if (!res.ok) {
    if (json.code === 'channels_confirming') {
      throw new OpenConfirmationPending(
        json.error ?? 'El pago puede haber entrado. No vuelvas a firmar.',
        json.hash,
      );
    }
    throw new ChannelRequestError(res.status, json.code ?? 'channels_submit', json.error ?? 'No se pudo enviar el pago.');
  }
  return json;
}
