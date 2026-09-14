import { newTurnState, runTurn, type Turn } from '@/lib/agent/loop';
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
const turns = new Map<string, Turn>();

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not set. See DEPLOY.md — the agent cannot run without it.' },
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

      try {
        const { snapshot } = await withSession(body.sessionId, body.snapshot, async (session) => {
          const turn = turns.get(body.sessionId) ?? newTurnState();
          turns.set(body.sessionId, turn);
          await runTurn(session, turn, body.message, emit);
        });

        // The browser keeps this and sends it back, because this instance
        // might not be here next time.
        emit({ t: 'done', stopReason: 'end_turn', snapshot });
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
