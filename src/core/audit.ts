import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Keys whose values never reach the audit log. Free text is always redacted. */
const REDACT = /(token|secret|password|authorization|email|phone|ssn|national|birth|address|name|comment|note|reason|text|summary|body|sample|answer|question|content|json|section|draft|feedback|goal_?note|message)/i;
/** Any string longer than this is treated as free text and redacted whatever its key. */
const MAX_PLAIN = 128;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? "[REDACTED]" : redact(x, depth + 1)]));
  }
  if (typeof v === "string" && v.length > MAX_PLAIN) return `[REDACTED ${v.length} chars]`;
  return v;
}

export type AuditEvent = { tool: string; tenantId: string; userId: string; outcome: "ok" | "denied" | "error"; inputs: unknown; detail?: string };

export class Audit {
  readonly events: AuditEvent[] = [];
  constructor(private readonly path?: string) {}
  record(e: AuditEvent): void {
    const safe = { ts: new Date().toISOString(), ...e, inputs: redact(e.inputs) };
    this.events.push(safe as AuditEvent);
    if (!this.path) return;
    try { mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }); appendFileSync(this.path, `${JSON.stringify(safe)}\n`, { mode: 0o600 }); }
    catch { process.stderr.write('{"src":"audit","evt":"write_failed"}\n'); }
  }
}
