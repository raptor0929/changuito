import type Anthropic from '@anthropic-ai/sdk';

/**
 * One request to a model, and what comes back.
 *
 * Deliberately narrow. A provider does not know about MCP, render tools, carts
 * or the UI protocol — it takes Anthropic-shaped messages, streams deltas, and
 * returns content blocks in the same shape. Everything that makes changuito's
 * loop what it is stays in `loop.ts`, so adding a provider cannot change the
 * behaviour the tests pin.
 */

export interface HopRequest {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.ToolUnion[];
  messages: Anthropic.MessageParam[];
  /**
   * Milliseconds this hop may take before it is abandoned.
   *
   * The caller owns this, not the provider: `/api/chat` has `maxDuration = 300`
   * for the *whole turn*, and hop nine cannot be given the same budget hop one
   * had.
   */
  budgetMs: number;
}

export interface HopCallbacks {
  onText(delta: string): void;
  onThinking(delta: string): void;
}

export interface HopResult {
  content: Anthropic.ContentBlockParam[];
  stopReason: Anthropic.Message['stop_reason'];
}

export interface Provider {
  readonly kind: 'anthropic' | 'ollama';
  /** The model name, for the log line and the dev banner. */
  readonly label: string;
  hop(req: HopRequest, cb: HopCallbacks): Promise<HopResult>;
}

/**
 * A provider that did not produce a reply.
 *
 * Distinct from any other error because the loop treats it as routine: a local
 * model behind a tunnel to someone's laptop is expected to fail sometimes, and
 * the answer is the other provider rather than an apology to the user.
 */
export class ProviderFailure extends Error {
  // Declared and assigned rather than a `readonly stage` parameter property:
  // those emit an assignment instead of erasing, so `--experimental-strip-types`
  // rejects them outright — and this file has to be loadable by the tests.
  readonly stage: 'request' | 'first-byte' | 'stream';

  constructor(message: string, stage: 'request' | 'first-byte' | 'stream') {
    super(message);
    this.name = 'ProviderFailure';
    this.stage = stage;
  }
}
