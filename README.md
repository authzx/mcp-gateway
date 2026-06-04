# Vengtoo MCP Gateway

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-≥18-339933.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/@vengtoo/mcp-gateway)](https://www.npmjs.com/package/@vengtoo/mcp-gateway)

**Authorization gateway for AI agents and MCP tool calls.**

> Open-source. Drop-in. Works with any MCP client.

## Why

AI agents connected to MCP servers can call any tool they have access to — read your database, delete files, execute arbitrary SQL. Vengtoo MCP Gateway puts a policy enforcement point between the agent and those tools, so every call is authorized before it executes.

## What it does

- Sits between MCP clients (Claude Code, Cursor, VS Code, GitHub Copilot) and any MCP server
- Intercepts every tool call and checks authorization before forwarding
- Two modes: **cloud** (Vengtoo Cloud API) and **local** (Vengtoo Agent + .rego policy file)
- Full audit trail of every tool invocation — subject, tool name, arguments, and decision are logged as structured JSON:

```json
{"ts":"2026-05-25T10:03:11.482Z","level":"info","msg":"mcp_tool_call","subject":"agent:ai-assistant","tool":"database__query","allowed":true,"latency_ms":0.8}
```

## Quick Start

1. Install and start the [Vengtoo Agent](https://github.com/vengtoo/agent). The agent runs locally and evaluates your authorization policy — no cloud account needed.

```bash
go install github.com/vengtoo/agent/cmd/agent@latest
vengtoo-agent --policy ./policy.rego
```

Create a `policy.rego` to define what your agent can do:

```rego
package vengtoo.mcp

default allow := false

# Allow read-only tools
allow if { input.resource.name == "database__query" }
allow if { input.resource.name == "database__list_tables" }

# Allow writes, but block destructive SQL
allow if {
    input.resource.name == "database__execute"
    not contains(lower(input.resource.attributes.sql), "drop")
    not contains(lower(input.resource.attributes.sql), "delete from")
}
```

See [`demo/policies/`](demo/policies/) for more examples including Kubernetes namespace protection.

2. Create a `gateway.config.json`:

```json
{
  "vengtoo": {
    "agentUrl": "http://localhost:8181"
  },
  "subject": "agent:ai-assistant",
  "servers": {
    "database": {
      "command": "node",
      "args": ["./my-database-mcp-server.js"]
    }
  }
}
```

3. Add to your MCP client (e.g. Claude Code):

```bash
claude mcp add --transport stdio vengtoo-gateway -- \
  npx vengtoo-mcp-gateway --config /path/to/gateway.config.json
```

## Configuration

### Config schema

| Field              | Type   | Required | Description                                                    |
| ------------------ | ------ | -------- | -------------------------------------------------------------- |
| `vengtoo.agentUrl`  | string | \*       | URL of local Vengtoo Agent (local mode)                         |
| `vengtoo.cloudUrl`  | string | \*       | URL of Vengtoo Cloud API (cloud mode)                           |
| `vengtoo.apiKey`    | string |          | API key from [Vengtoo Cloud](https://console.vengtoo.com) (or set `VENGTOO_API_KEY` env var) |
| `vengtoo.timeoutMs` | number |          | Authorization request timeout (default: 5000)                  |
| `subject`          | string | yes      | Identity of the agent making tool calls                        |
| `subjectType`      | string |          | Subject type (default: `"agent"`)                              |
| `resourceType`     | string |          | Resource type for authorization checks (default: `"mcp_tool"`) |
| `servers`          | object | yes      | Map of downstream MCP servers to proxy                         |

\* Provide either `agentUrl` (local mode) or `cloudUrl` (cloud mode).

Each entry in `servers` has:

| Field     | Type     | Required | Description                      |
| --------- | -------- | -------- | -------------------------------- |
| `command` | string   | yes      | Command to spawn the MCP server  |
| `args`    | string[] |          | Command arguments                |
| `env`     | object   |          | Additional environment variables |

## Modes

### Cloud mode

Connect to Vengtoo Cloud for managed policies:

```json
{
  "vengtoo": {
    "cloudUrl": "https://api.vengtoo.com/access/v1/evaluation",
    "apiKey": "azx_..."
  },
  "subject": "agent:prod-assistant",
  "servers": {
    "database": {
      "command": "node",
      "args": ["./db-server.js"]
    }
  }
}
```

### Local mode

Run the Vengtoo Agent locally with a .rego policy file for offline, self-contained authorization:

```bash
# Start the agent with your policy
vengtoo-agent --policy ./policy.rego
```

```json
{
  "vengtoo": {
    "agentUrl": "http://localhost:8181"
  },
  "subject": "agent:dev-assistant",
  "servers": {
    "database": {
      "command": "node",
      "args": ["./db-server.js"]
    }
  }
}
```

## CLI Flags

| Flag                       | Description                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `--config <path>`          | Path to gateway config file (default: `./gateway.config.json`)                         |
| `--list-tools`             | List all tools from configured downstream servers and exit                             |
| `--generate-policy [path]` | Generate a starter .rego policy file for the configured tools (default: `policy.rego`) |

Environment variable overrides: `VENGTOO_API_KEY`, `VENGTOO_AGENT_URL`, `AUTHZX_SUBJECT`.

## MCP Client Setup

The gateway runs as a stdio MCP server. Point your MCP client at it instead of the downstream server directly.

### Claude Code

```bash
claude mcp add --transport stdio vengtoo-gateway -- \
  npx vengtoo-mcp-gateway --config /path/to/gateway.config.json
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vengtoo-gateway": {
      "command": "npx",
      "args": ["vengtoo-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vengtoo-gateway": {
      "command": "npx",
      "args": ["vengtoo-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "vengtoo-gateway": {
      "type": "stdio",
      "command": "npx",
      "args": ["vengtoo-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

See [`demo/`](demo/) for full end-to-end examples with sample policies.

## Feedback

- [GitHub Issues](https://github.com/vengtoo/mcp-gateway/issues) — Bug reports and feature requests
- [Documentation](https://docs.vengtoo.com) — Guides and API reference

## License

Apache-2.0 — see [LICENSE](LICENSE).
