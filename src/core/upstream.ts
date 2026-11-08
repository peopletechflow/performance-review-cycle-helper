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

/** Official MCP SDK client. The caller's own bearer token is attached to every request; there is no shared token. */
export async function connectUpstream(opts: { url: string; accessToken: string } | { transport: Transport }): Promise<Upstream> {
  const client = new Client({ name: "workday-mcp-task-gateway", version: "0.2.0" });
  const transport = "transport" in opts ? opts.transport : (() => {
    const u = new URL(opts.url);
    if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("WORKDAY_MCP_URL must use https (http only for loopback).");
    return new StreamableHTTPClientTransport(u, { requestInit: { headers: { Authorization: `Bearer ${opts.accessToken}` } } });
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
      catch (e) { throw new UpstreamUnknownError(`Upstream call failed: ${(e as Error).message.slice(0, 200)}`); }
      const data = r.structuredContent ?? (() => {
        const t = (r.content as { type: string; text?: string }[] | undefined)?.find((x) => x.type === "text")?.text;
        if (t === undefined) return undefined;
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
  capabilities: z.record(z.object({ tool: z.string().min(1), args: z.record(ArgSpec).default({}), resultPath: z.string().optional() }).strict()),
}).strict();
export type Mapping = z.infer<typeof MappingFile>;

export type CapabilityDef = { kind: "read" | "write"; inputs: readonly string[]; output: z.ZodTypeAny; description: string };
export type CapabilityStatus = { capability: string; kind: "read" | "write"; status: "available" | "gated"; upstreamTool?: string; reason?: string };

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
      const t = tools.get(m.tool);
      if (!t) { set("gated", `upstream tool '${m.tool}' not found in tools/list`); continue; }
      const props = Object.keys(t.inputSchema?.properties ?? {});
      const extra = Object.keys(m.args).filter((a) => !props.includes(a));
      const missing = (t.inputSchema?.required ?? []).filter((r) => !(r in m.args));
      const badFrom = Object.values(m.args).flatMap((a) => ("from" in a && !def.inputs.includes(a.from) ? [a.from] : []));
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
    if (r.isError) throw new UpstreamToolError(`Workday MCP returned an error for ${cap}: ${String((r.data as { message?: unknown })?.message ?? "no detail").slice(0, 300)}`);
    const parsed = def.output.safeParse(pick(r.data, m.resultPath));
    if (!parsed.success) throw new UpstreamUnknownError(`Workday MCP response for ${cap} does not match the expected contract: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return parsed.data as T;
  }
}

/** Identity contract every tenant mapping must provide: who the token belongs to, per Workday. */
export const IDENTITY_CAPABILITY: CapabilityDef = { kind: "read", inputs: [], description: "Signed-in worker identity", output: z.object({ tenantId: z.string().min(1).max(128), workerId: z.string().min(1).max(128) }).strip() };
