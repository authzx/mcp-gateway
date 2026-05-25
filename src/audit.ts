import type { GatewayConfig } from "./types";
import { randomUUID } from "crypto";

interface AuditEvent {
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  tenant_id: string;
  request_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  source: string;
}

interface ToolCallRecord {
  requestId: string;
  subject: string;
  tool: string;
  args: Record<string, unknown>;
  allowed: boolean;
  reason?: string;
  latencyMs: number;
  timestamp: string;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 100;
const POST_TIMEOUT_MS = 10_000;
const MAX_BUFFER_SIZE = 10_000;

export class AuditForwarder {
  private buffer: AuditEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly auditUrl: string | undefined;
  private readonly auth: string | undefined;
  private readonly tenantId: string;
  private flushing = false;

  constructor(private config: GatewayConfig) {
    this.tenantId = config.audit?.tenantId ?? "";
    this.auditUrl = this.resolveAuditUrl();
    this.auth = this.resolveAuth();

    if (this.auditUrl) {
      this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
      console.error(`[authzx-gateway] audit forwarding → ${this.auditUrl}`);
    } else {
      console.error("[authzx-gateway] audit forwarding disabled (no audit endpoint configured)");
    }
  }

  record(rec: ToolCallRecord): void {
    const event: AuditEvent = {
      entity_type: "mcp_tool",
      entity_id: rec.tool,
      action: "invoke",
      actor_id: rec.subject,
      tenant_id: this.tenantId,
      request_id: rec.requestId,
      metadata: {
        tool: rec.tool,
        arguments: rec.args,
        allowed: rec.allowed,
        reason: rec.reason,
        latency_ms: rec.latencyMs,
        gateway: "authzx-mcp-gateway",
      },
      created_at: rec.timestamp,
      source: "mcp-gateway",
    };

    this.buffer.push(event);

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      const dropped = this.buffer.length - MAX_BUFFER_SIZE;
      this.buffer = this.buffer.slice(dropped);
      console.error(`[authzx-gateway] audit buffer overflow: dropped ${dropped} oldest event(s)`);
    }

    this.logStructured(rec);

    if (this.buffer.length >= MAX_BATCH_SIZE) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing || !this.auditUrl) return;

    this.flushing = true;
    const batch = this.buffer.splice(0, MAX_BATCH_SIZE);

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (this.auth) headers["Authorization"] = this.auth;

      const res = await fetch(this.auditUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      clearTimeout(t);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[authzx-gateway] audit flush failed (${res.status}): ${text}`);
        this.buffer.unshift(...batch);
      } else {
        const body = (await res.json()) as { accepted?: number; rejected?: number };
        if (body.rejected && body.rejected > 0) {
          console.error(`[authzx-gateway] audit: ${body.accepted} accepted, ${body.rejected} rejected`);
        }
      }
    } catch (err) {
      console.error(`[authzx-gateway] audit flush error: ${(err as Error).message}`);
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private logStructured(rec: ToolCallRecord): void {
    const entry = {
      ts: rec.timestamp,
      level: rec.allowed ? "info" : "warn",
      msg: "mcp_tool_call",
      subject: rec.subject,
      tool: rec.tool,
      allowed: rec.allowed,
      reason: rec.reason,
      latency_ms: rec.latencyMs,
      request_id: rec.requestId,
    };
    console.error(JSON.stringify(entry));
  }

  private resolveAuditUrl(): string | undefined {
    const audit = this.config.audit;
    if (!audit?.forwardUrl) {
      const agentUrl = this.config.authzx.agentUrl;
      if (!agentUrl) return undefined;
      const base = agentUrl.replace(/\/$/, "");
      const origin = new URL(base).origin;
      return `${origin}/audit-srv/v1/agent-logs/ingest`;
    }
    return audit.forwardUrl;
  }

  private resolveAuth(): string | undefined {
    const a = this.config.authzx;
    if (a.apiKey) return `Bearer ${a.apiKey}`;
    if (a.clientId && a.clientSecret) {
      return `Basic ${Buffer.from(`${a.clientId}:${a.clientSecret}`).toString("base64")}`;
    }
    return undefined;
  }
}

export function generateRequestId(): string {
  return randomUUID();
}
