import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

/** Upstream said the call failed (isError). Treated as a definitive failure for writes. */
export class UpstreamToolError extends Error { constructor(m: string) { super(m); this.name = "UpstreamToolError"; } }
/** Transport failure, timeout or a response that does not match the contract. Outcome of a write is unknown. */
export class UpstreamUnknownError extends Error { constructor(m: string) { super(m); this.name = "UpstreamUnknownError"; } }
/** The capability has no verified mapping for this tenant. */
export class CapabilityGated extends Error { constructor(readonly capability: string, reason: string) { super(`'${capability}' is not available: ${reason}`); this.name = "CapabilityGated"; } }

export type UpstreamTool = { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } };
export interface Upstream { listTools(): Promise<UpstreamTool[]>; call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ isError: boolean; data: unknown }>; close(): Promise<void> }

/** Upper bound on one upstream tool result, before parsing. */
export const MAX_UPSTREAM_TEXT = 1_000_000;

/** Official MCP SDK client. Redirects are refused so the bearer token is never replayed to another origin. The caller's own bearer token is attached to every request; there is no shared token. */
export async function connectUpstream(opts: { url: string; accessToken: string } | { transport: Transport }): Promise<Upstream> {
  const client = new Client({ name: "workday-mcp-task-gateway", version: "0.2.0" });
  const transport = "transport" in opts ? opts.transport : (() => {
    const u = new URL(opts.url);
    if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("WORKDAY_MCP_URL must use https (http only for loopback).");
    return new StreamableHTTPClientTransport(u, { requestInit: { headers: { Authorization: `Bearer ${opts.accessToken}` }, redirect: "error" } });
  })();
  await client.connect(transport);
  return {
    async listTools() {
      const out: UpstreamTool[] = []; let cursor: string | undefined;
      do { const r = await client.listTools(cursor ? { cursor } : undefined); out.push(...(r.tools as UpstreamTool[])); cursor = r.nextCursor; } while (cursor && out.length < 2000);
      return out;
    },
    async call(name, args, timeoutMs) {
      let r: Awaited<ReturnType<typeof client.callTool>>;
      try { r = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }); }
      catch (e) { throw new UpstreamUnknownError(`Upstream call failed: ${scrub((e as Error).message)}`); }
      if (r.structuredContent !== undefined && JSON.stringify(r.structuredContent).length > MAX_UPSTREAM_TEXT) throw new UpstreamToolError(`Workday MCP response for ${name} is too large; refusing to use it.`);
      const data = r.structuredContent ?? (() => {
        const t = (r.content as { type: string; text?: string }[] | undefined)?.find((x) => x.type === "text")?.text;
        if (t === undefined) return undefined;
        if (t.length > MAX_UPSTREAM_TEXT) throw new UpstreamToolError(`Workday MCP response for ${name} is larger than ${MAX_UPSTREAM_TEXT} characters; refusing to parse.`);
        try { return JSON.parse(t); } catch { return r.isError ? { message: t } : undefined; }
      })();
      return { isError: Boolean(r.isError), data };
    },
    close: () => client.close(),
  };
}

/** Tenant mapping file: which upstream Workday MCP tool serves each capability and how arguments map. */
const ArgSpec = z.union([z.object({ from: z.string() }).strict(), z.object({ const: z.union([z.string(), z.number(), z.boolean()]) }).strict()]);
export const MappingFile = z.object({
  version: z.literal(1),
  verifiedAgainst: z.string().optional(),
  capabilities: z.record(z.string(), z.object({ tool: z.string().min(1), args: z.record(z.string(), ArgSpec).default({}), resultPath: z.string().optional(), fieldMap: z.record(z.string(), z.string().min(1)).optional() }).strict()),
}).strict();
export type Mapping = z.infer<typeof MappingFile>;

export type CapabilityDef = { kind: "read" | "write"; inputs: readonly string[]; output: z.ZodTypeAny; description: string;
  /** Upstream tools that must never back this capability (for example manager/HR actions behind a self-service write). */
  denyTools?: readonly string[] };
/** Argument names that would let a mapping point a call at someone other than the signed-in caller. */
const TARGET_ARG = /(worker|employee|person|subject|target|user|manager|wid)/i;
export type CapabilityStatus = { capability: string; kind: "read" | "write"; status: "available" | "gated"; upstreamTool?: string; reason?: string };

/** Remove bearer tokens, long opaque strings, emails and control characters from upstream error text. */
export function scrub(msg: string): string {
  return msg.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[A-Za-z0-9_\-+/=]{40,}/g, "[redacted]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
}
/** Upstream said the caller lacks access (as opposed to an empty result). */
export const isAccessDenied = (e: unknown) => e instanceof UpstreamToolError && /\b(403|forbidden|not authori[sz]ed|permission|access denied|security)\b/i.test(e.message);

/** Inputs the upstream may legitimately not accept: date windows are re-applied locally; idempotency falls back to our durable commit table. */
const OPTIONAL_INPUTS = new Set(["from", "to", "idempotencyKey"]);

const pick = (v: unknown, path?: string) => (path ? path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v) : v);

/**
 * Allowlisted task gateway over an upstream Workday MCP server. Only capabilities with a mapping
 * whose tool exists upstream and whose arguments match the advertised input schema are callable.
 * Responses are validated strictly against the capability's output schema.
 */
export class Gateway {
  private readonly status = new Map<string, CapabilityStatus>();
  private constructor(private readonly up: Upstream | undefined, private readonly mapping: Mapping | undefined, private readonly defs: Record<string, CapabilityDef>, private readonly timeoutMs: number) {}

  static async create(up: Upstream | undefined, mapping: Mapping | undefined, defs: Record<string, CapabilityDef>, opts: { timeoutMs?: number; disabled?: readonly string[] } = {}): Promise<Gateway> {
    const g = new Gateway(up, mapping, defs, opts.timeoutMs ?? 15_000);
    const tools = up ? new Map((await up.listTools()).map((t) => [t.name, t])) : new Map<string, UpstreamTool>();
    for (const [cap, def] of Object.entries(defs)) {
      const set = (status: "available" | "gated", reason?: string, upstreamTool?: string) => g.status.set(cap, { capability: cap, kind: def.kind, status, reason, upstreamTool });
      const m = mapping?.capabilities[cap];
      if (opts.disabled?.includes(cap)) { set("gated", "disabled by operator (kill switch)"); continue; }
      if (!up) { set("gated", "no upstream Workday MCP server configured"); continue; }
      if (!m) { set("gated", "no tenant mapping configured"); continue; }
      if (/^REPLACE/i.test(m.tool)) { set("gated", "placeholder tool name from the example mapping; set the real upstream tool name", m.tool); continue; }
      if (def.denyTools?.includes(m.tool)) { set("gated", `upstream tool '${m.tool}' is not allowed for this self-service capability`, m.tool); continue; }
      const pinned = Object.entries(m.args).filter(([k, a]) => "const" in a && TARGET_ARG.test(k)).map(([k]) => k);
      if (pinned.length) { set("gated", `mapping pins a person/target argument to a constant (${pinned.join(",")}); identity must come from the caller's own session`, m.tool); continue; }
      const t = tools.get(m.tool);
      if (!t) { set("gated", `upstream tool '${m.tool}' not found in tools/list`); continue; }
      const props = Object.keys(t.inputSchema?.properties ?? {});
      const extra = Object.keys(m.args).filter((a) => !props.includes(a));
      const missing = (t.inputSchema?.required ?? []).filter((r) => !(r in m.args));
      const badFrom = Object.values(m.args).flatMap((a) => ("from" in a && !def.inputs.includes(a.from) ? [a.from] : []));
      const mappedFrom = new Set(Object.values(m.args).flatMap((a) => ("from" in a ? [a.from] : [])));
      const unmappedInputs = def.inputs.filter((i) => !OPTIONAL_INPUTS.has(i) && !mappedFrom.has(i));
      if (unmappedInputs.length) { set("gated", `inputs not mapped to an upstream argument: ${unmappedInputs.join(",")} (see tools/list inputSchema for '${m.tool}')`, m.tool); continue; }
      if (extra.length || missing.length || badFrom.length) { set("gated", `mapping does not match upstream schema (unknown args: ${extra.join(",") || "-"}; missing required: ${missing.join(",") || "-"}; invalid sources: ${badFrom.join(",") || "-"})`, m.tool); continue; }
      set("available", undefined, m.tool);
    }
    for (const cap of Object.keys(mapping?.capabilities ?? {})) if (!defs[cap]) throw new Error(`Mapping names unknown capability '${cap}'.`);
    return g;
  }

  capabilities(): CapabilityStatus[] { return [...this.status.values()]; }
  isAvailable(cap: string): boolean { return this.status.get(cap)?.status === "available"; }

  async invoke<T>(cap: string, input: Record<string, unknown>): Promise<T> {
    const st = this.status.get(cap); const def = this.defs[cap];
    if (!st || !def || st.status !== "available") throw new CapabilityGated(cap, st?.reason ?? "unknown capability");
    const m = this.mapping!.capabilities[cap];
    const args: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(m.args)) { const v = "const" in spec ? spec.const : input[spec.from]; if (v !== undefined) args[k] = v; }
    const r = await this.up!.call(m.tool, args, this.timeoutMs);
    if (r.isError) throw new UpstreamToolError(`Workday MCP returned an error for ${cap}: ${scrub(String((r.data as { message?: unknown })?.message ?? "no detail"))}`);
    const picked = pick(r.data, m.resultPath);
    const shaped = m.fieldMap ? Object.fromEntries(Object.entries(m.fieldMap).map(([ours, path]) => [ours, pick(picked, path)])) : picked;
    const parsed = def.output.safeParse(shaped);
    if (!parsed.success) throw new UpstreamUnknownError(`Workday MCP response for ${cap} does not match the expected contract: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return parsed.data as T;
  }
}

/** Identity contract every tenant mapping must provide: who the token belongs to, per Workday. */
export const IDENTITY_CAPABILITY: CapabilityDef = { kind: "read", inputs: [], description: "Signed-in worker identity", output: z.object({ tenantId: z.string().min(1).max(128).optional(), workerId: z.string().min(1).max(128) }).strip() };
