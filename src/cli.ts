#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve } from "path";
import type { GatewayConfig } from "./types";
import { startGateway } from "./gateway";

const config = loadConfig();

if (process.argv.includes("--list-tools")) {
  import("./list-tools").then((m) => m.listTools(config));
} else if (process.argv.includes("--generate-policy")) {
  const outFlag = process.argv.indexOf("--generate-policy");
  const outPath = process.argv[outFlag + 1] || "policy.rego";
  import("./generate-policy").then((m) => m.generatePolicy(config, outPath));
} else {
  startGateway(config).catch((err) => {
    console.error("[authzx-gateway] fatal:", err);
    process.exit(1);
  });
}

function loadConfig(): GatewayConfig {
  const configFlag = process.argv.indexOf("--config");
  const configPath =
    configFlag !== -1 && process.argv[configFlag + 1]
      ? resolve(process.argv[configFlag + 1])
      : resolve("gateway.config.json");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as GatewayConfig;

    if (!config.authzx) throw new Error("missing 'authzx' section");
    if (!config.subject) throw new Error("missing 'subject'");
    if (!config.servers || Object.keys(config.servers).length === 0) {
      throw new Error("missing 'servers' — configure at least one downstream MCP server");
    }

    if (process.env.AUTHZX_API_KEY) config.authzx.apiKey = process.env.AUTHZX_API_KEY;
    if (process.env.AUTHZX_AGENT_URL) config.authzx.agentUrl = process.env.AUTHZX_AGENT_URL;
    if (process.env.AUTHZX_SUBJECT) config.subject = process.env.AUTHZX_SUBJECT;

    if (config.authzx.agentUrl) {
      try { new URL(config.authzx.agentUrl); } catch {
        throw new Error(`'authzx.agentUrl' is not a valid URL: ${config.authzx.agentUrl}`);
      }
    }
    if (config.authzx.cloudUrl) {
      try { new URL(config.authzx.cloudUrl); } catch {
        throw new Error(`'authzx.cloudUrl' is not a valid URL: ${config.authzx.cloudUrl}`);
      }
    }
    for (const [name, srv] of Object.entries(config.servers)) {
      if (!srv.command || typeof srv.command !== "string") {
        throw new Error(`server '${name}' must have a non-empty 'command' string`);
      }
    }
    if (config.authzx.timeoutMs !== undefined) {
      if (typeof config.authzx.timeoutMs !== "number" || config.authzx.timeoutMs <= 0) {
        throw new Error(`'authzx.timeoutMs' must be a positive number`);
      }
    }

    return config;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Config not found: ${configPath}`);
      console.error(`Usage: authzx-mcp-gateway --config <path>`);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Invalid config: ${message}`);
    process.exit(1);
  }
}
