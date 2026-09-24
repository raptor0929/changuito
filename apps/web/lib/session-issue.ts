import { requireHuman } from './human-gate.ts';
import { mintUserToken, sessionSecret, userCookieHeader } from './login-gate.ts';
import { proofFromBody, verifyWalletProof } from './wallet-proof-verify.ts';

/**
 * POST /api/session/login { address, proof } — issue `chg_user`.
 *
 * That cookie lifts the guest turn limits, so it is worth exactly as much as
 * the check before it. It used to be signed for any well-formed address the
 * browser named. Now the browser has to show a fresh SEP-53 signature from
 * that wallet over a login message (lib/wallet-proof.ts): Pollar makes one
 * for a custodial wallet only inside a logged-in session, and an external
 * wallet only with its owner's approval. A bare address gets 401.
 *
 * Passkey smart wallets (C…) cannot sign SEP-53, so they stay on guest
 * limits. That is the safe failure.
 *
 * Its own module so the refusals can be tested as a route; the handler only
 * forwards to it.
 */
export async function issueUserSession(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  const secret = sessionSecret(env);
  if (!secret) {
    console.error('[session] CHG_SESSION_SECRET is not set in production — refusing to sign sessions.');
    return Response.json(
      { error: 'session_unconfigured', message: 'El inicio de sesión no está disponible ahora.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected_json' }, { status: 400 });
  }
  const raw = (body as { address?: unknown } | null)?.address;
  const address = typeof raw === 'string' ? raw.trim() : '';
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    return Response.json({ error: 'invalid_address' }, { status: 400 });
  }

  const verdict = verifyWalletProof({ intent: 'login', address, proof: proofFromBody(body), now });
  if (!verdict.ok) {
    return Response.json(
      {
        error: verdict.error === 'proof_missing' ? 'session_proof_required' : 'session_proof_invalid',
        message: 'No pudimos confirmar tu sesión. Iniciá sesión de nuevo.',
      },
      { status: 401 },
    );
  }

  const token = await mintUserToken(address, secret, now);
  return new Response(JSON.stringify({ ok: true, address }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': userCookieHeader(token) },
  });
}
