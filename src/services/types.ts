import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";

/**
 * A service is a self-contained module that registers a group of tools.
 * To add a service: create src/services/<id>/index.ts exporting a ServiceModule,
 * add it to the list in src/services/index.ts, and document it in docs/services/<id>.md.
 */
export interface ServiceModule {
  /** Stable id, also used as tool-name prefix (e.g. "gi" → gi_search_documents). */
  id: string;
  /** Human-readable name for logs. */
  name: string;
  /** Returns null when enabled, or a reason string when disabled (e.g. missing credentials). */
  disabledReason(config: Config): string | null;
  register(server: McpServer, config: Config): void;
}
