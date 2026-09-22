import type { Cart, Product } from '@changuito/mcp/types';
import type { SessionSnapshot } from '@changuito/mcp/session';

import type { UiEvent } from './protocol';

/**
 * The transcript, as a reducer over UiEvents.
 *
 * Pure and framework-free so the ordering rules can be tested without a
 * browser. The ordering is the whole difficulty: a product grid arrives in
 * the middle of a sentence, and if it is appended to the end of the turn the
 * user reads "acá están los precios" above nothing, then a grid below the
 * paragraph that was supposed to follow it.
 */

export interface ToolRun {
  id: string;
  name: string;
  ms?: number;
  ok?: boolean;
}

export type Block =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'say'; id: string; text: string; thinking: string; tools: ToolRun[] }
  | { kind: 'products'; id: string; items: Product[]; note?: string }
  | { kind: 'cart'; id: string; cart: Cart; handoffUrl?: string }
  | { kind: 'error'; id: string; message: string; recoverable: boolean };

export interface ChatState {
  blocks: Block[];
  /** True between send and `done`. Drives the composer's disabled state. */
  streaming: boolean;
  /** Opaque to the browser; handed back on the next turn so the agent remembers. */
  snapshot?: SessionSnapshot;
  /** The newest cart seen, wherever it appeared. What the pay button settles. */
  cart?: { cart: Cart; handoffUrl?: string };
}

export const initialState: ChatState = { blocks: [], streaming: false };

let seq = 0;
const nextId = () => `b${++seq}`;

/** Exported for tests, which need ids to be predictable. */
export function resetIds(): void {
  seq = 0;
}

export function sendUser(state: ChatState, text: string): ChatState {
  return {
    ...state,
    streaming: true,
    blocks: [...state.blocks, { kind: 'user', id: nextId(), text }],
  };
}

/**
 * Append to the open `say` block, or start one. A block stops being open as
 * soon as anything else is appended, which is what keeps text on the correct
 * side of a grid.
 */
function intoSay(blocks: Block[], f: (b: Extract<Block, { kind: 'say' }>) => Extract<Block, { kind: 'say' }>): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'say') return [...blocks.slice(0, -1), f(last)];
  return [...blocks, f({ kind: 'say', id: nextId(), text: '', thinking: '', tools: [] })];
}

/**
 * `Array.prototype.findLastIndex` by hand: the app targets ES2022 and that one
 * is ES2023, so it does not typecheck here.
 */
function lastIndexWhere(blocks: Block[], match: (b: Block, i: number) => boolean): number {
  for (let i = blocks.length - 1; i >= 0; i--) if (match(blocks[i]!, i)) return i;
  return -1;
}

export function applyEvent(state: ChatState, e: UiEvent): ChatState {
  switch (e.t) {
    case 'text':
      return { ...state, blocks: intoSay(state.blocks, (b) => ({ ...b, text: b.text + e.delta })) };

    case 'thinking':
      return { ...state, blocks: intoSay(state.blocks, (b) => ({ ...b, thinking: b.thinking + e.delta })) };

    case 'tool_start':
      return {
        ...state,
        blocks: intoSay(state.blocks, (b) => ({ ...b, tools: [...b.tools, { id: e.id, name: e.name }] })),
      };

    case 'tool_end':
      // Lands on whichever block holds that call, not necessarily the open one:
      // a search that finishes after a grid was drawn still belongs to its own turn.
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.kind === 'say' && b.tools.some((t) => t.id === e.id)
            ? { ...b, tools: b.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, ms: e.ms } : t)) }
            : b,
        ),
      };

    case 'products':
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'products', id: nextId(), items: e.items, note: e.note }],
      };

    case 'cart': {
      // One cart card per turn.
      //
      // The agent renders the basket twice on purpose — once when it is built,
      // once when the handoff link exists — and appending both left two cards
      // on screen, the first without the link and the second with it. Reading
      // that, the basket looks like it was ordered twice.
      //
      // Scoped to the current turn rather than the whole transcript: a cart
      // shown three messages ago is a record of what the basket was then, and
      // rewriting it would edit history the user has already scrolled past.
      const turnStart = lastIndexWhere(state.blocks, (b) => b.kind === 'user');
      const existing = lastIndexWhere(
        state.blocks,
        (b, i) => i > turnStart && b.kind === 'cart' && b.cart.cartId === e.cart.cartId,
      );
      const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'cart' }>);

      const block = (id: string): Block => ({
        kind: 'cart',
        id,
        cart: e.cart,
        // Never take the link back off a card that already had one. The render
        // that adds it is the second of the pair, so this only matters in the
        // other order, where dropping it would remove a button the user saw.
        handoffUrl: e.handoffUrl ?? prior?.handoffUrl,
      });

      return {
        ...state,
        cart: { cart: e.cart, handoffUrl: e.handoffUrl ?? prior?.handoffUrl },
        blocks:
          // Reusing the id matters: React keys off it, so the card updates in
          // place instead of unmounting and animating back in.
          prior
            ? state.blocks.map((b, i) => (i === existing ? block(prior.id) : b))
            : [...state.blocks, block(nextId())],
      };
    }

    case 'error':
      return {
        ...state,
        // An unrecoverable error ends the turn; nothing further is coming.
        streaming: e.recoverable ? state.streaming : false,
        blocks: [...state.blocks, { kind: 'error', id: nextId(), message: e.message, recoverable: e.recoverable }],
      };

    case 'done':
      return { ...state, streaming: false, snapshot: e.snapshot };
  }
}

/** A dropped connection is not a `done`, so the composer has to be freed by hand. */
export function endTurn(state: ChatState, message?: string): ChatState {
  if (!state.streaming) return state;
  const blocks = message
    ? [...state.blocks, { kind: 'error' as const, id: nextId(), message, recoverable: true }]
    : state.blocks;
  return { ...state, streaming: false, blocks };
}

/**
 * Drop error bubbles whose text is exactly `message`.
 * Same reference when nothing matches, so a no-op clear does not re-render.
 */
export function omitErrorMessage(state: ChatState, message: string): ChatState {
  let changed = false;
  const blocks = state.blocks.filter((b) => {
    if (b.kind === 'error' && b.message === message) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed ? { ...state, blocks } : state;
}
