import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const AUTHZX_DIR = join(process.cwd(), ".authzx");
const ID_FILE = join(AUTHZX_DIR, "gateway.id");

export function getOrCreateGatewayId(): string {
  if (existsSync(ID_FILE)) {
    return readFileSync(ID_FILE, "utf-8").trim();
  }

  mkdirSync(AUTHZX_DIR, { recursive: true });
  const id = `gw_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  writeFileSync(ID_FILE, id, "utf-8");
  return id;
}
