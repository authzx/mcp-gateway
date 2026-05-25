export interface GatewayConfig {
  authzx: {
    agentUrl?: string;
    cloudUrl?: string;
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    timeoutMs?: number;
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
