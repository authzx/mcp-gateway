import { writeFileSync } from "fs";
import { resolve } from "path";
import type { GatewayConfig } from "./types";
import { discoverTools, type DiscoveredTool } from "./utils";

export async function generatePolicy(
  config: GatewayConfig,
  outputPath: string
): Promise<void> {
  const tools: DiscoveredTool[] = [];

  for (const [name, cfg] of Object.entries(config.servers)) {
    try {
      const { tools: discovered, transport } = await discoverTools(name, cfg);
      tools.push(...discovered);
      await transport.close();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[!] Failed to connect to "${name}": ${message}`);
    }
  }

  if (tools.length === 0) {
    console.error("No tools discovered — cannot generate policy.");
    process.exit(1);
  }

  const rego = buildRego(tools);
  const dest = resolve(outputPath);
  writeFileSync(dest, rego, "utf-8");

  console.log(`Generated policy with ${tools.length} tool(s) → ${dest}`);
  console.log(`\nEdit the file to customize which tools to allow or block.`);
  console.log(`Then start the agent:\n`);
  console.log(`  authzx-agent --policy ${outputPath} --listen :8181\n`);

  process.exit(0);
}

function buildRego(tools: DiscoveredTool[]): string {
  const servers = [...new Set(tools.map((t) => t.server))];
  const lines: string[] = [];

  lines.push("package authzx.mcp");
  lines.push("");
  lines.push("default allow := false");
  lines.push("");

  for (const server of servers) {
    const serverTools = tools.filter((t) => t.server === server);
    lines.push(`# ── ${server} ${"─".repeat(Math.max(0, 50 - server.length))}`);
    lines.push("#");
    for (const tool of serverTools) {
      const desc = tool.description ? ` — ${tool.description}` : "";
      const inputs = tool.inputFields.length > 0
        ? ` (inputs: ${tool.inputFields.join(", ")})`
        : "";
      lines.push(`#   ${tool.qualifiedName}${desc}${inputs}`);
    }
    lines.push("");

    for (const tool of serverTools) {
      lines.push(`allow if {`);
      lines.push(`    input.resource.name == "${tool.qualifiedName}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  lines.push("# ── Customize: block specific operations ─────────────────");
  lines.push("#");
  lines.push("# To block tools conditionally, remove the allow rule above");
  lines.push("# and add a conditional rule instead. Example:");
  lines.push("#");

  const toolWithInput = tools.find((t) => t.inputFields.length > 0);
  if (toolWithInput) {
    const field = toolWithInput.inputFields[0];
    lines.push(`# allow if {`);
    lines.push(`#     input.resource.name == "${toolWithInput.qualifiedName}"`);
    lines.push(`#     ${field} := lower(input.resource.attributes.${field})`);
    lines.push(`#     not contains(${field}, "drop")`);
    lines.push(`#     not contains(${field}, "truncate")`);
    lines.push(`# }`);
    lines.push("#");
    lines.push("# reason := \"Operation blocked by policy\" if {");
    lines.push(`#     input.resource.name == "${toolWithInput.qualifiedName}"`);
    lines.push(`#     ${field} := lower(input.resource.attributes.${field})`);
    lines.push(`#     contains(${field}, "drop")`);
    lines.push("# }");
  } else {
    lines.push("# allow if {");
    lines.push(`#     input.resource.name == "${tools[0].qualifiedName}"`);
    lines.push("#     # add conditions here");
    lines.push("# }");
  }
  lines.push("");

  return lines.join("\n");
}

