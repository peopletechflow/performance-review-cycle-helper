import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { MappingFile, type Mapping } from "./upstream.js";

/** Read a secret from a file the operator controls. Refuses group/world-readable files. Never logged. */
export function readSecretFile(path: string, label: string): string {
  const st = statSync(path);
  if ((st.mode & 0o077) !== 0) throw new Error(`${label} file must not be readable by group or others (chmod 600).`);
  const v = readFileSync(path, "utf8").trim();
  if (!v) throw new Error(`${label} file is empty.`);
  return v;
}
export const loadMapping = (path: string): Mapping => MappingFile.parse(JSON.parse(readFileSync(path, "utf8")));
const RoleMap = z.record(z.string(), z.object({ roles: z.array(z.string()).min(1), denies: z.array(z.string()).optional() }).strict());
export const loadRoleMap = (path: string) => RoleMap.parse(JSON.parse(readFileSync(path, "utf8")));
export const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
