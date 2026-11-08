import { z, type ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccessDenied, LiveUnsupported, type Caller } from "./identity.js";
import { permissionsFor, type RoleTable } from "./policy.js";
import type { Store } from "./store.js";
import { CapabilityGated, UpstreamToolError, UpstreamUnknownError } from "./upstream.js";

export type ToolKind = "read" | "propose" | "commit";
export type ToolDef<S extends ZodRawShape = ZodRawShape> = {
  name: string; kind: ToolKind; permission: string; description: string; input: S;
  run: (args: z.objectOutputType<S, z.ZodTypeAny>, caller: Caller) => Promise<unknown> | unknown;
};
export const defineTool = <S extends ZodRawShape>(t: ToolDef<S>): ToolDef => t as unknown as ToolDef;

/** Only tools whose permission the caller holds are listed or callable. Operator kill switch removes tools entirely. */
export function visibleTools(tools: readonly ToolDef[], caller: Caller, roles: RoleTable, disabled: readonly string[] = []): ToolDef[] {
  const perms = permissionsFor(caller, roles);
  return tools.filter((t) => perms.has(t.permission) && !disabled.includes(t.name));
}

export type CallResult = { ok: true; data: unknown } | { ok: false; error: string; code: string };
const codeOf = (e: unknown) =>
  e instanceof AccessDenied ? "denied" : e instanceof LiveUnsupported ? "live_unsupported" : e instanceof CapabilityGated ? "gated"
  : e instanceof UpstreamToolError ? "upstream_error" : e instanceof UpstreamUnknownError ? "upstream_unknown" : "error";

export async function callTool(tools: readonly ToolDef[], roles: RoleTable, store: Store, caller: Caller, name: string, raw: unknown, disabled: readonly string[] = []): Promise<CallResult> {
  const t = visibleTools(tools, caller, roles, disabled).find((x) => x.name === name);
  const base = { tool: name, tenantId: caller.tenantId, userId: caller.userId, inputs: raw };
  if (!t) { await store.audit({ ...base, outcome: "denied", detail: "not permitted" }); return { ok: false, code: "denied", error: `Tool '${name}' is not available to you.` }; }
  const parsed = z.object(t.input).strict().safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, code: "invalid_input", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  try {
    const data = await t.run(parsed.data, caller);
    await store.audit({ ...base, outcome: "ok" });
    return { ok: true, data };
  } catch (e) {
    const code = codeOf(e);
    await store.audit({ ...base, outcome: code === "error" ? "error" : code, detail: (e as Error).name });
    if (code === "error") process.stderr.write(`${JSON.stringify({ src: "tool", tool: name, err: (e as Error).message.slice(0, 200) })}\n`);
    return { ok: false, code, error: code === "error" ? "Internal error." : (e as Error).message };
  }
}

export function buildMcpServer(info: { name: string; version: string; title?: string }, tools: readonly ToolDef[], roles: RoleTable, store: Store, caller: Caller, disabled: readonly string[] = []): McpServer {
  const server = new McpServer(info);
  for (const t of visibleTools(tools, caller, roles, disabled)) {
    server.registerTool(t.name, { description: `[${t.kind}] ${t.description}`, inputSchema: t.input }, async (args: unknown) => {
      const r = await callTool(tools, roles, store, caller, t.name, args, disabled);
      return r.ok
        ? { content: [{ type: "text" as const, text: JSON.stringify(r.data, null, 2) }] }
        : { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: r.code, error: r.error }) }] };
    });
  }
  return server;
}
