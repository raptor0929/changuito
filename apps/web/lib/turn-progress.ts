import type { ChatState } from './chat-state';
import { TOOL_LABELS } from './tool-labels.ts';

/**
 * The waiting line under the composer, as copy.
 *
 * A basket can take a minute, and a spinner that says the same thing for all
 * of it reads as stuck. Everything here comes from something that actually
 * happened: a `status` event from the server, a tool that has not reported
 * back, reply text arriving, or the clock. No percentages and no steps the
 * turn has not reached — a bar that fills on a timer is a promise the server
 * never made.
 */

/** Past this the wait deserves an explanation. */
export const SLOW_MS = 12_000;

/** Past this it deserves an exit. */
export const VERY_SLOW_MS = 40_000;

export interface ProgressCopy {
  /** What is happening now. Announced politely to screen readers. */
  stage: string;
  /** Why it is taking a while, or what the user can do. */
  hint: string;
  /** Whole seconds since the turn started. Visual only. */
  seconds: number;
}

/** The MCP tool still running in the current turn, if any. */
export function pendingTool(state: ChatState): string | undefined {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const b = state.blocks[i]!;
    if (b.kind === 'user') return undefined;
    if (b.kind !== 'say') continue;
    for (let j = b.tools.length - 1; j >= 0; j--) {
      if (b.tools[j]!.ok === undefined) return b.tools[j]!.name;
    }
  }
  return undefined;
}

function stageCopy(state: ChatState): string {
  const tool = pendingTool(state);
  if (tool) return `${TOOL_LABELS[tool] ?? 'Consultando al súper'}…`;

  const p = state.progress;
  if (!p) return 'Enviando tu mensaje…';
  if (p.writing) return 'Escribiendo la respuesta…';
  switch (p.stage) {
    case 'received':
      return 'Recibido. Preparando la búsqueda…';
    case 'fallback':
      return 'Probando por otro camino para no hacerte esperar…';
    case 'thinking':
      return p.hop === 0 ? 'Pensando qué buscar…' : 'Revisando lo que encontré…';
  }
}

function hintCopy(elapsedMs: number): string {
  if (elapsedMs >= VERY_SLOW_MS) {
    return 'Está tardando más que de costumbre. Podés esperar o tocar Parar y probar de nuevo.';
  }
  if (elapsedMs >= SLOW_MS) {
    return 'Los supermercados a veces tardan en responder. Sigo con tu pedido.';
  }
  return 'Tocá Parar si querés cambiar el pedido.';
}

export function progressCopy(state: ChatState, elapsedMs: number): ProgressCopy {
  const ms = Math.max(0, elapsedMs);
  return { stage: stageCopy(state), hint: hintCopy(ms), seconds: Math.floor(ms / 1000) };
}
