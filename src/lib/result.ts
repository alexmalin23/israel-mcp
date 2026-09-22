import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool result helpers. Every tool returns:
 *  - `structuredContent` for programmatic clients
 *  - a JSON text block for models/clients that only read `content`
 */
export function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Errors are returned as tool results (isError) so the model can recover, not thrown. */
export function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Run a tool body and convert any thrown error into an isError result.
 * Usage: async (args) => run(async () => ok(await doWork(args)))
 */
export async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return fail(e);
  }
}
