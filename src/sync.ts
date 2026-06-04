import type { GatewayConfig, DriftEvent, ToolSnapshot } from "./types";
import type { ClassifiedTool } from "./classify";
import { classifyTools } from "./classify";
import { computeToolsHash, hasChanged, saveHash } from "./hash";
import { loadSnapshot, saveSnapshot } from "./snapshot";
import { detectDrift, logDriftEvents } from "./drift";
import { getOrCreateGatewayId } from "./gateway-id";
import type { DiscoveredTool } from "./utils";

const SYNC_TIMEOUT_MS = 10_000;
const DEFAULT_CLOUD_BASE = "https://api.vengtoo.com";

interface SyncResponse {
  synced: number;
  created: number;
  updated: number;
  unchanged: number;
  gateway_id: string;
  server: string;
  drifted_count?: number;
  blocked_tools?: string[];
}

interface DownstreamLike {
  name: string;
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
}

export async function syncAllServers(
  config: GatewayConfig,
  downstreams: DownstreamLike[]
): Promise<Set<string>> {
  const gatewayId = getOrCreateGatewayId();
  const blockedTools = new Set<string>();
  console.error(`[authzx-gateway] gateway id: ${gatewayId}`);

  for (const ds of downstreams) {
    const hash = computeToolsHash(ds.tools);

    const toolSnapshots: ToolSnapshot[] = ds.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));

    let driftEvents: DriftEvent[] = [];
    const oldSnapshot = loadSnapshot(ds.name);

    if (oldSnapshot && hasChanged(ds.name, hash)) {
      driftEvents = detectDrift(ds.name, oldSnapshot, toolSnapshots);
      if (driftEvents.length > 0) {
        logDriftEvents(driftEvents);
      }
    }

    if (!hasChanged(ds.name, hash) && oldSnapshot) {
      console.error(`[authzx-gateway] tools unchanged for '${ds.name}' — skipping sync`);
      continue;
    }

    const schemas = new Map<string, unknown>();
    const discovered: DiscoveredTool[] = ds.tools.map((t) => {
      const qn = `${ds.name}__${t.name}`;
      schemas.set(qn, t.inputSchema);
      return {
        qualifiedName: qn,
        server: ds.name,
        originalName: t.name,
        description: t.description ?? "",
        inputFields: [],
      };
    });

    const classified = classifyTools(discovered, schemas);

    if (config.authzx.apiKey) {
      try {
        const result = await syncToolsToCloud(
          config,
          gatewayId,
          ds.name,
          classified,
          hash,
          driftEvents
        );
        if (result) {
          saveHash(ds.name, hash);
          saveSnapshot(ds.name, toolSnapshots, hash);
          console.error(
            `[authzx-gateway] synced ${result.synced} tools for '${ds.name}' (${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged)`
          );
          if (result.drifted_count && result.drifted_count > 0) {
            console.error(
              `[authzx-gateway] ${result.drifted_count} tool(s) drifted from approved baseline for '${ds.name}'`
            );
          }
          if (result.blocked_tools) {
            for (const tool of result.blocked_tools) {
              blockedTools.add(`${ds.name}__${tool}`);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[authzx-gateway] cloud sync failed for '${ds.name}' — ${msg}`);
      }
    } else {
      saveHash(ds.name, hash);
      saveSnapshot(ds.name, toolSnapshots, hash);
      if (config.authzx.blockOnDrift && driftEvents.length > 0) {
        for (const e of driftEvents) {
          if (e.severity === "CRITICAL") {
            blockedTools.add(`${ds.name}__${e.toolName}`);
          }
        }
        console.error(
          `[authzx-gateway] blockOnDrift enabled — ${blockedTools.size} tool(s) blocked locally`
        );
      }
    }
  }

  return blockedTools;
}

async function syncToolsToCloud(
  config: GatewayConfig,
  gatewayId: string,
  serverName: string,
  tools: ClassifiedTool[],
  hash: string,
  driftEvents: DriftEvent[]
): Promise<SyncResponse | null> {
  const baseUrl = resolveBaseUrl(config);
  const url = `${baseUrl}/v1/gateways/${gatewayId}/tools/sync`;

  const body = {
    server: serverName,
    tools: tools.map((t) => ({
      name: t.originalName,
      trust: t.trust,
      description: t.description,
      schema: t.schema,
    })),
    hash,
    drift_events: driftEvents.length > 0 ? driftEvents : undefined,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const auth = resolveAuth(config);
  if (auth) headers["Authorization"] = auth;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[authzx-gateway] sync returned ${res.status}: ${text}`);
      return null;
    }
    return (await res.json()) as SyncResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveBaseUrl(config: GatewayConfig): string {
  if (config.authzx.cloudUrl) {
    const url = new URL(config.authzx.cloudUrl);
    return `${url.protocol}//${url.host}`;
  }
  return DEFAULT_CLOUD_BASE;
}

function resolveAuth(config: GatewayConfig): string | undefined {
  if (config.authzx.apiKey) return `Bearer ${config.authzx.apiKey}`;
  if (config.authzx.clientId && config.authzx.clientSecret) {
    return `Basic ${Buffer.from(`${config.authzx.clientId}:${config.authzx.clientSecret}`).toString("base64")}`;
  }
  return undefined;
}
