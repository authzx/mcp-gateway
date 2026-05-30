import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const HASH_DIR = join(process.cwd(), ".authzx", "hashes");

export function computeToolsHash(
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const payload = sorted.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function hasChanged(serverName: string, currentHash: string): boolean {
  const path = hashPath(serverName);
  if (!existsSync(path)) return true;
  try {
    return readFileSync(path, "utf-8").trim() !== currentHash;
  } catch {
    return true;
  }
}

export function saveHash(serverName: string, hash: string): void {
  if (!existsSync(HASH_DIR)) {
    mkdirSync(HASH_DIR, { recursive: true });
  }
  writeFileSync(hashPath(serverName), hash, "utf-8");
}

function hashPath(serverName: string): string {
  return join(HASH_DIR, `${serverName}.hash`);
}
