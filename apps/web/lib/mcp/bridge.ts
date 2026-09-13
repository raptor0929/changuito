import type Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * MCP's tool descriptions and Anthropic's are nearly the same object, which is
 * not an accident — but "nearly" is where the bugs live, so the translation is
 * explicit and in one place.
 */

/** VTEX endpoints hang rather than fail. Never let one stall a whole turn. */
const CALL_TIMEOUT_MS = 30_000;

export async function mcpToolsToAnthropic(client: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await client.listTools();

  return tools.map((t) => {
    const raw = (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>;
    // The MCP SDK runs zod-to-json-schema, which stamps a draft-07 `$schema`
    // onto every tool. Anthropic's input_schema has no such field.
    const { $schema: _drop, ...schema } = raw;

    return {
      name: t.name,
      description: t.description ?? t.title ?? t.name,
      input_schema: { type: 'object', properties: {}, ...schema } as Anthropic.Tool.InputSchema,
    };
  });
}

/**
 * Call a tool and turn whatever happens into a tool_result.
 *
 * Every path here returns a block, including the failures. An exception that
 * escapes leaves the assistant's tool_use unanswered, and the next request
 * then 400s on a malformed conversation — so a broken supermarket endpoint
 * would break the chat itself rather than just the search. The model handles
 * `is_error` perfectly well: it reads the message and tries a different
 * postal code.
 */
export async function callMcpTool(
  client: Client,
  use: { id: string; name: string; input: unknown },
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const res = await client.callTool(
      { name: use.name, arguments: (use.input ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    );

    const text = ((res.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: text || '(no output)',
      is_error: res.isError === true,
    };
  } catch (e) {
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: e instanceof Error ? e.message : String(e),
      is_error: true,
    };
  }
}
