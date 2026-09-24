import { authorizeFaucet } from './faucet-auth.ts';
import type { FaucetProof } from './faucet-proof.ts';
import { requireHuman } from './human-gate.ts';
import { addressKind } from './stellar.ts';

/**
 * Everything POST /api/faucet decides before it touches the chain.
 *
 * Its own module so the refusals can be tested as a route: the handler
 * itself imports the contract bindings, which ship as TypeScript inside
 * node_modules and cannot load under `--experimental-strip-types`.
 *
 * Returns the address to fund, or the Response to send instead. Nothing
 * here signs, funds or mints.
 */
export async function gateFaucet(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<{ address: string; kind: 'account' | 'contract' } | Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  let address: string;
  let proof: Partial<FaucetProof> | null = null;
  try {
    const body = (await req.json()) as { address?: unknown; proof?: unknown };
    address = typeof body.address === 'string' ? body.address : '';
    if (body.proof && typeof body.proof === 'object') proof = body.proof as Partial<FaucetProof>;
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const kind = addressKind(address);
  if (!kind) return Response.json({ error: 'not a Stellar address' }, { status: 400 });

  const auth = authorizeFaucet({ address, proof, now, env });
  if (!auth.ok) return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });

  return { address, kind };
}
