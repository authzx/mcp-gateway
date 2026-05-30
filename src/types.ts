export interface GatewayConfig {
  authzx: {
    agentUrl?: string;
    cloudUrl?: string;
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    timeoutMs?: number;
    blockOnDrift?: boolean;
  };
  subject: string;
  subjectType?: string;
  resourceType?: string;
  servers: Record<string, ServerConfig>;
  audit?: {
    forwardUrl?: string;
    tenantId?: string;
  };
}

export interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AuthorizeResult {
  allowed: boolean;
  reason?: string;
}

export type DriftSeverity = "CRITICAL" | "WARNING" | "INFO";

export type DriftChangeType =
  | "tool_removed"
  | "tool_added"
  | "parameter_removed"
  | "parameter_added"
  | "type_changed"
  | "description_changed";

export interface DriftEvent {
  toolName: string;
  serverName: string;
  severity: DriftSeverity;
  changeType: DriftChangeType;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
}

export interface ToolSnapshot {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ServerSnapshot {
  server: string;
  hash: string;
  tools: ToolSnapshot[];
  capturedAt: string;
}
