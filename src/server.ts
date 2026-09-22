import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { services } from "./services/index.js";

export const SERVER_NAME = "israel-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ServiceStatus {
  id: string;
  name: string;
  enabled: boolean;
  reason?: string;
}

/**
 * Builds the MCP server with every enabled service registered.
 * Transport-agnostic: index.ts wires it to stdio; an HTTP entrypoint can reuse this as-is.
 */
export function createServer(config: Config): { server: McpServer; status: ServiceStatus[] } {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tools for Israeli services. Prefixes: gov_ = data.gov.il open data, boi_ = Bank of Israel exchange rates, " +
        "hebcal_/il_ = Jewish calendar, holidays and Israeli business days, gi_ = Green Invoice invoicing. " +
        "Dates are YYYY-MM-DD. Amounts are in ILS unless a currency is given. " +
        "gi_create_document is two-step: dryRun preview → show the user → dryRun=false with the preview's confirmationToken only after explicit user confirmation. If it reports 'outcome unknown', never retry blindly — check gi_search_documents.",
    },
  );

  const status: ServiceStatus[] = services.map((svc) => {
    const reason = svc.disabledReason(config);
    if (reason) return { id: svc.id, name: svc.name, enabled: false, reason };
    svc.register(server, config);
    return { id: svc.id, name: svc.name, enabled: true };
  });

  return { server, status };
}
