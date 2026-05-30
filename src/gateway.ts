import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig, ServerConfig } from "./types";
import { authorize } from "./authorize";
import { AuditForwarder, generateRequestId } from "./audit";
import { syncAllServers } from "./sync";

interface DownstreamServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
}

export async function startGateway(config: GatewayConfig): Promise<void> {
  process.on("unhandledRejection", (err) => {
    console.error("[authzx-gateway] unhandled rejection:", err);
  });

  const downstreams = await spawnDownstreams(config.servers);
  const toolIndex = buildToolIndex(downstreams);
  const audit = new AuditForwarder(config);
  let blockedTools = new Set<string>();

  syncAllServers(config, downstreams)
    .then((blocked) => { blockedTools = blocked; })
    .catch((err) =>
      console.error("[authzx-gateway] tool sync warning:", err instanceof Error ? err.message : err)
    );

  const shutdown = async () => {
    for (const ds of downstreams) {
      try { await ds.transport.close(); } catch { /* best effort */ }
    }
    await audit.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const server = new Server(
    { name: "authzx-mcp-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [];
    for (const ds of downstreams) {
      for (const tool of ds.tools) {
        tools.push({
          name: qualifiedName(ds.name, tool.name),
          description: `[${ds.name}] ${tool.description ?? ""}`.trim(),
          inputSchema: tool.inputSchema,
        });
      }
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const fullName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const requestId = generateRequestId();
    const entry = toolIndex.get(fullName);

    if (!entry) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${fullName}` }],
        isError: true,
      };
    }

    if (blockedTools.has(fullName)) {
      audit.record({
        requestId,
        subject: config.subject,
        tool: fullName,
        args,
        allowed: false,
        reason: "schema drift detected — tool blocked until admin re-approves",
        latencyMs: 0,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: "text", text: `[AuthzX] Tool "${fullName}" is blocked — schema drift detected. An admin must re-approve this tool in the AuthzX console.` }],
        isError: true,
      };
    }

    const start = performance.now();
    const result = await authorize(config, config.subject, fullName, args);
    const latencyMs = Math.round(performance.now() - start);

    if (!result.allowed) {
      const reason = result.reason ?? "denied by policy";
      audit.record({
        requestId,
        subject: config.subject,
        tool: fullName,
        args,
        allowed: false,
        reason,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: "text", text: `[AuthzX] Access denied: tool "${fullName}" was blocked by AuthzX authorization policy. Reason: ${reason}` }],
        isError: true,
      };
    }

    try {
      const result = await entry.downstream.client.callTool({
        name: entry.originalName,
        arguments: args,
      });
      audit.record({
        requestId,
        subject: config.subject,
        tool: fullName,
        args,
        allowed: true,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      audit.record({
        requestId,
        subject: config.subject,
        tool: fullName,
        args,
        allowed: true,
        reason: `downstream error: ${message}`,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: "text", text: `Downstream server error for "${fullName}": ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[authzx-gateway] running — ${downstreams.length} server(s), ${toolIndex.size} tool(s)`);
}

async function spawnDownstreams(
  servers: Record<string, ServerConfig>
): Promise<DownstreamServer[]> {
  const results: DownstreamServer[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    console.error(`[authzx-gateway] connecting to ${name}: ${cfg.command} ${(cfg.args ?? []).join(" ")}`);
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
    console.error(`[authzx-gateway] ${name}: ${tools.length} tool(s) registered`);

    results.push({
      name,
      client,
      transport,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  return results;
}

interface ToolEntry {
  downstream: DownstreamServer;
  originalName: string;
}

function buildToolIndex(downstreams: DownstreamServer[]): Map<string, ToolEntry> {
  const index = new Map<string, ToolEntry>();
  for (const ds of downstreams) {
    for (const tool of ds.tools) {
      const qn = qualifiedName(ds.name, tool.name);
      index.set(qn, { downstream: ds, originalName: tool.name });
    }
  }
  return index;
}

function qualifiedName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}
