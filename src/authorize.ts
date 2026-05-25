import type { GatewayConfig, AuthorizeResult } from "./types";

const DEFAULT_CLOUD_URL = "https://api.authzx.com/v1/authorize";
const DEFAULT_TIMEOUT_MS = 10_000;

interface AuthZENResponse {
  decision?: boolean;
  allowed?: boolean;
  context?: { reason?: string; reason_code?: string; policy_id?: string };
  reason?: string;
}

function normalizeResponse(raw: AuthZENResponse): AuthorizeResult {
  const allowed = raw.decision ?? raw.allowed ?? false;
  const reason = raw.context?.reason ?? raw.reason;
  return { allowed, reason };
}

export async function authorize(
  config: GatewayConfig,
  subjectId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<AuthorizeResult> {
  const body = {
    subject: { type: config.subjectType ?? "agent", id: subjectId },
    resource: { type: config.resourceType ?? "mcp_tool", name: toolName, attributes: args },
    action: { name: "invoke" },
  };
  const timeoutMs = config.authzx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const auth = authHeader(config);
  const endpoints = resolveEndpoints(config);

  let lastError: Error | undefined;
  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const isLast = i === endpoints.length - 1;
    try {
      const res = await postJson(url, body, auth, timeoutMs);
      if (res.ok) return normalizeResponse((await res.json()) as AuthZENResponse);
      const text = await safeText(res);
      if (res.status === 401) {
        return deny(`authentication failed — check your API key`);
      }
      if (res.status === 404) {
        return deny(`no authorization policy configured for this tool`);
      }
      if (res.status >= 500 && !isLast) {
        lastError = new Error(`${url}: ${res.status} ${text}`);
        continue;
      }
      return deny(`authorization service error (${res.status})`);
    } catch (err) {
      lastError = err as Error;
      if (isLast) break;
    }
  }
  console.error("[authzx-gateway] authorize failed:", lastError);
  return deny(`authz unreachable: ${lastError?.message ?? "unknown"}`);
}

function resolveEndpoints(config: GatewayConfig): string[] {
  const urls: string[] = [];
  const a = config.authzx;
  if (a.agentUrl) {
    const base = a.agentUrl.replace(/\/$/, "");
    urls.push(base.endsWith("/v1/authorize") ? base : `${base}/v1/authorize`);
  }
  if (a.cloudUrl) urls.push(a.cloudUrl);
  if (urls.length === 0) urls.push(DEFAULT_CLOUD_URL);
  return urls;
}

function authHeader(config: GatewayConfig): string | undefined {
  const a = config.authzx;
  if (a.apiKey) return `Bearer ${a.apiKey}`;
  if (a.clientId && a.clientSecret) {
    return `Basic ${Buffer.from(`${a.clientId}:${a.clientSecret}`).toString("base64")}`;
  }
  return undefined;
}

async function postJson(url: string, body: unknown, auth: string | undefined, timeoutMs: number): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (auth) headers["Authorization"] = auth;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}

function deny(reason: string): AuthorizeResult {
  return { allowed: false, reason };
}
