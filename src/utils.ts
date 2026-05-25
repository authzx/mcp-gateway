import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServerConfig } from "./types";

export interface DiscoveredTool {
  qualifiedName: string;
  server: string;
  originalName: string;
  description: string;
  inputFields: string[];
}

export function extractFields(schema: unknown): string[] {
  if (
    typeof schema === "object" &&
    schema !== null &&
    "properties" in schema
  ) {
    return Object.keys(
      (schema as { properties: Record<string, unknown> }).properties
    );
  }
  return [];
}

export async function discoverTools(
  name: string,
  cfg: ServerConfig
): Promise<{ tools: DiscoveredTool[]; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
  });
  const client = new Client(
    { name: `authzx-gateway/${name}`, version: "0.1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  const { tools } = await client.listTools();

  const discovered: DiscoveredTool[] = tools.map((t) => ({
    qualifiedName: `${name}__${t.name}`,
    server: name,
    originalName: t.name,
    description: t.description ?? "",
    inputFields: extractFields(t.inputSchema),
  }));

  return { tools: discovered, transport };
}
