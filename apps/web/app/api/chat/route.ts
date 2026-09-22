import { newTurnState, runTurn } from '@/lib/agent/loop';
import { turnStore } from '@/lib/agent/turn-store';
import { withSession } from '@/lib/mcp/session';
import { encodeEvent, HEARTBEAT, SSE_HEADERS, type ChatRequest, type UiEvent } from '@/lib/protocol';

/**
 * Node, not edge: the MCP server reads `node:url` and the Stellar SDK needs
 * real crypto. Edge would fail at import, not at request time, which is a
 * confusing way to find out.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Conversation history, alongside the MCP session it belongs to. */
const turns = turnStore();

const HEARTBEAT_MS = 15_000;

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!body.sessionId || typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: 'sessionId and a non-empty message are required.' }, { status: 400 });
  }

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasOllama = Boolean(process.env.OLLAMA_URL?.trim());
  const provider = (process.env.AGENT_PROVIDER ?? '').trim().toLowerCase();
  const ollamaOk = hasOllama && (provider === 'ollama' || provider === 'auto' || provider === '');
  if (!hasAnthropic && !ollamaOk) {
    return Response.json(
      {
        error:
          'Falta un modelo: seteá ANTHROPIC_API_KEY, o OLLAMA_URL con AGENT_PROVIDER=ollama en .env.local. Ver DEPLOY.md.',
      },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // the browser went away mid-turn
        }
      };
      const emit = (e: UiEvent): void => write(encodeEvent(e));

      // A single search against a slow storefront can go 20s without a byte,
      // and an idle stream is a stream a proxy feels free to close.
      const beat = setInterval(() => write(HEARTBEAT), HEARTBEAT_MS);

      // Hoisted out of the callback so the `done` event can carry it.
      let brain: string | undefined;

      try {
        const { snapshot } = await withSession(body.sessionId, body.snapshot, async (session) => {
          // Read, run, write — all inside the callback, so `withSession`'s
          // per-session queue covers the whole read-modify-write and two tabs
          // on one id cannot each save a history missing the other's messages.
          const turn = (await turns.get(body.sessionId)) ?? newTurnState();
          brain = (await runTurn(session, turn, body.message, emit)).brain;

          // Only after a clean return. A turn that threw mid-hop can leave an
          // assistant `tool_use` with no matching `tool_result`, and the API
          // rejects that pairing on the *next* request — so the failure would
          // surface one message later, on a turn that did nothing wrong.
          // Keeping the previous history leaves every stored value valid, at
          // the cost of one message the user is about to retry anyway.
          await turns.set(body.sessionId, turn);
        });

        // The browser keeps this and sends it back, because this instance
        // might not be here next time.
        emit({ t: 'done', stopReason: 'end_turn', snapshot, brain });
      } catch (e) {
        emit({
          t: 'error',
          message: e instanceof Error ? e.message : String(e),
          recoverable: true,
        });
      } finally {
        clearInterval(beat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
