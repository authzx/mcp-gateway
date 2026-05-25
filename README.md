# AuthzX MCP Gateway

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-≥18-339933.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/@authzx/mcp-gateway)](https://www.npmjs.com/package/@authzx/mcp-gateway)

**Authorization gateway for AI agents and MCP tool calls.**

> Open-source. Drop-in. Works with any MCP client.

## What it does

- Sits between MCP clients (Claude Code, Cursor, VS Code, GitHub Copilot) and any MCP server
- Intercepts every tool call and checks authorization before forwarding
- Two modes: **cloud** (AuthzX Cloud API) and **local** (AuthzX Agent + .rego policy file)
- Full audit trail of every tool invocation with subject, tool name, arguments, and decision

## Quick Start

1. Install and start the [AuthzX Agent](https://github.com/authzx/agent) with a local policy:

```bash
go install github.com/authzx/agent/cmd/agent@latest
authzx-agent --policy ./policy.rego
```

2. Create a `gateway.config.json`:

```json
{
  "authzx": {
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
claude mcp add --transport stdio authzx-gateway -- \
  npx authzx-mcp-gateway --config /path/to/gateway.config.json
```

## Configuration

### Config schema

| Field              | Type   | Required | Description                                                    |
| ------------------ | ------ | -------- | -------------------------------------------------------------- |
| `authzx.agentUrl`  | string | \*       | URL of local AuthzX Agent (local mode)                         |
| `authzx.cloudUrl`  | string | \*       | URL of AuthzX Cloud API (cloud mode)                           |
| `authzx.apiKey`    | string |          | API key for cloud mode (or set `AUTHZX_API_KEY` env var)       |
| `authzx.timeoutMs` | number |          | Authorization request timeout (default: 5000)                  |
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

Connect to AuthzX Cloud for managed policies:

```json
{
  "authzx": {
    "cloudUrl": "https://api.authzx.com/v1/authorize",
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

Run the AuthzX Agent locally with a .rego policy file for offline, self-contained authorization:

```bash
# Start the agent with your policy
authzx-agent --policy ./policy.rego
```

```json
{
  "authzx": {
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

Environment variable overrides: `AUTHZX_API_KEY`, `AUTHZX_AGENT_URL`, `AUTHZX_SUBJECT`.

## MCP Client Setup

The gateway runs as a stdio MCP server. Point your MCP client at it instead of the downstream server directly.

### Claude Code

```bash
claude mcp add --transport stdio authzx-gateway -- \
  npx authzx-mcp-gateway --config /path/to/gateway.config.json
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "authzx-gateway": {
      "command": "npx",
      "args": ["authzx-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "authzx-gateway": {
      "command": "npx",
      "args": ["authzx-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "authzx-gateway": {
      "type": "stdio",
      "command": "npx",
      "args": ["authzx-mcp-gateway", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

See [`demo/`](demo/) for full end-to-end examples with sample policies.

## Feedback

- [GitHub Issues](https://github.com/authzx/mcp-gateway/issues) — Bug reports and feature requests
- [Documentation](https://docs.authzx.com) — Guides and API reference

## License

Apache-2.0 — see [LICENSE](LICENSE).
