import { createHash } from "node:crypto";

/** Stable JSON (sorted keys) so a digest binds content, not key order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const digest = (v: unknown): string => createHash("sha256").update(canonical(v)).digest("hex");
