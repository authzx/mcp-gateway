import type {
  DriftEvent,
  DriftSeverity,
  ServerSnapshot,
  ToolSnapshot,
} from "./types";

export function detectDrift(
  serverName: string,
  oldSnapshot: ServerSnapshot,
  newTools: ToolSnapshot[]
): DriftEvent[] {
  const events: DriftEvent[] = [];

  const oldMap = new Map(oldSnapshot.tools.map((t) => [t.name, t]));
  const newMap = new Map(newTools.map((t) => [t.name, t]));

  for (const [name, oldTool] of oldMap) {
    if (!newMap.has(name)) {
      events.push({
        toolName: name,
        serverName,
        severity: "CRITICAL",
        changeType: "tool_removed",
        message: `Tool "${name}" was removed from server "${serverName}"`,
      });
      continue;
    }

    const newTool = newMap.get(name)!;
    events.push(...compareTools(serverName, oldTool, newTool));
  }

  for (const name of newMap.keys()) {
    if (!oldMap.has(name)) {
      events.push({
        toolName: name,
        serverName,
        severity: "WARNING",
        changeType: "tool_added",
        message: `New tool "${name}" appeared on server "${serverName}"`,
      });
    }
  }

  return events.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function compareTools(
  serverName: string,
  oldTool: ToolSnapshot,
  newTool: ToolSnapshot
): DriftEvent[] {
  const events: DriftEvent[] = [];

  if (oldTool.description !== newTool.description) {
    events.push({
      toolName: oldTool.name,
      serverName,
      severity: "INFO",
      changeType: "description_changed",
      oldValue: oldTool.description,
      newValue: newTool.description,
      message: `Description changed for tool "${oldTool.name}"`,
    });
  }

  const oldProps = getProperties(oldTool.inputSchema);
  const newProps = getProperties(newTool.inputSchema);

  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      events.push({
        toolName: oldTool.name,
        serverName,
        severity: "CRITICAL",
        changeType: "parameter_removed",
        field: key,
        oldValue: oldProps[key],
        message: `Parameter "${key}" removed from tool "${oldTool.name}"`,
      });
    } else if (oldProps[key]?.type !== newProps[key]?.type) {
      events.push({
        toolName: oldTool.name,
        serverName,
        severity: "CRITICAL",
        changeType: "type_changed",
        field: key,
        oldValue: oldProps[key]?.type,
        newValue: newProps[key]?.type,
        message: `Parameter "${key}" type changed from "${oldProps[key]?.type}" to "${newProps[key]?.type}" in tool "${oldTool.name}"`,
      });
    }
  }

  for (const key of Object.keys(newProps)) {
    if (!(key in oldProps)) {
      events.push({
        toolName: oldTool.name,
        serverName,
        severity: "WARNING",
        changeType: "parameter_added",
        field: key,
        newValue: newProps[key],
        message: `Parameter "${key}" added to tool "${oldTool.name}"`,
      });
    }
  }

  return events;
}

function getProperties(
  schema: unknown
): Record<string, { type?: string; [k: string]: unknown }> {
  if (
    typeof schema === "object" &&
    schema !== null &&
    "properties" in schema &&
    typeof (schema as Record<string, unknown>).properties === "object"
  ) {
    return (schema as { properties: Record<string, { type?: string }> }).properties;
  }
  return {};
}

export function maxSeverity(events: DriftEvent[]): DriftSeverity | null {
  if (events.length === 0) return null;
  if (events.some((e) => e.severity === "CRITICAL")) return "CRITICAL";
  if (events.some((e) => e.severity === "WARNING")) return "WARNING";
  return "INFO";
}

export function logDriftEvents(events: DriftEvent[]): void {
  for (const e of events) {
    console.error(`[authzx-gateway] DRIFT ${e.severity}: ${e.message}`);
  }
  if (events.length > 0) {
    const critical = events.filter((e) => e.severity === "CRITICAL").length;
    const warning = events.filter((e) => e.severity === "WARNING").length;
    const info = events.filter((e) => e.severity === "INFO").length;
    console.error(
      `[authzx-gateway] drift summary: ${critical} critical, ${warning} warning, ${info} info`
    );
  }
}

function severityRank(s: DriftSeverity): number {
  switch (s) {
    case "CRITICAL": return 0;
    case "WARNING": return 1;
    case "INFO": return 2;
  }
}
