/**
 * MCP tools over runtime-discovered Workday Agent-Ready tools, one per enabled capability ceiling.
 * There is no call-any tool. Each tool carries its ceiling's role permission (role denies apply) and consent.
 * Inside a capability the model picks among the tools currently approved and unchanged for it, using live
 * descriptions and schemas. Writes exist only for enabled write ceilings (none by default):
 * preview, then explicit confirm, then commit with a fingerprint re-check and durable idempotency.
 */
import { z } from "zod";
import { AccessDenied, type Caller } from "./identity.js";
import { digest } from "./preview.js";
import type { Store } from "./store.js";
import { defineTool, type ToolDef } from "./tool.js";
import { untrusted, UNTRUSTED_NOTE } from "./untrusted.js";
import { UpstreamToolError } from "./upstream.js";
import type { AgentToolRegistry, Ceiling } from "./agentready.js";

type PendingWrite = { tool: string; capability: string; fingerprint: string; args: Record<string, unknown> };
const Args = z.record(z.string(), z.unknown());
export const toolNameFor = (c: Ceiling, suffix = "") => `workday_${c.capability.replace(/[^a-z0-9]+/gi, "_")}${suffix}`;

export function agentReadyTools(o: { registry: AgentToolRegistry; store: Store; ceilings: readonly Ceiling[]; listPermission: string; workerId: (c: Caller) => string }): ToolDef[] {
  const { registry, store } = o;
  const key = (c: Caller) => `${c.tenantId}:${c.userId}`;
  const consent = async (c: Caller, ce: Ceiling) => { if (ce.consent && !(await store.hasConsent(c, ce.consent))) throw new AccessDenied(`Needs your opt-in for ${ce.consent}.`); };
  const out: ToolDef[] = [
    defineTool({ name: "workday_list_agent_tools", kind: "read", permission: o.listPermission, description: "Workday Agent-Ready tools you can use now, grouped by capability. Names, descriptions and schemas are discovered live and may change.", input: {},
      run: async () => { await registry.ensureFresh(); return { note: UNTRUSTED_NOTE, capabilities: o.ceilings.map((c) => ({ capability: c.capability, access: c.access, enabled: c.enabled, mcpTool: c.enabled ? toolNameFor(c, c.access === "write" ? "_preview" : "") : undefined })), tools: registry.statuses().map((s) => ({ ...s, description: s.description === undefined ? undefined : untrusted(s.description.slice(0, 4000)) })) }; } }),
  ];
  for (const ce of o.ceilings.filter((x) => x.enabled)) {
    if (ce.access === "read") {
      out.push(defineTool({ name: toolNameFor(ce), kind: "read", permission: ce.permission, description: `${ce.description}. Pick a tool listed for capability ${ce.capability} by workday_list_agent_tools. Person fields are filled from your identity; ids must come from your own earlier results.`,
        input: { tool: z.string().max(200), args: Args.default({}) },
        run: async (a, c) => { await consent(c, ce); return { note: UNTRUSTED_NOTE, result: untrusted(JSON.stringify(await registry.read(a.tool, ce.capability, a.args, o.workerId(c), key(c))).slice(0, 60_000)) }; } }));
      continue;
    }
    out.push(defineTool({ name: toolNameFor(ce, "_preview"), kind: "propose", permission: ce.permission, description: `${ce.description}: prepare the exact call for the user to read. Nothing is sent.`, input: { tool: z.string().max(200), args: Args.default({}) },
      run: async (a, c) => {
        await consent(c, ce); await registry.ensureFresh(true);
        const b = registry.buildArgs(a.tool, ce.capability, a.args, o.workerId(c), key(c));
        const p: PendingWrite = { tool: a.tool, capability: ce.capability, fingerprint: b.fingerprint, args: b.args };
        const r = await store.createResource(c, "agent_write", p, {}, "previewed");
        return { writeId: r.id, exactCall: p, ...(await store.issuePreview(c, "agent_write", r.id, r.version, p)), note: "Show the user this exact call in full. Commit only after they explicitly confirm it." };
      } }));
    out.push(defineTool({ name: toolNameFor(ce, "_commit"), kind: "commit", permission: ce.permission, description: `${ce.description}: send a previewed call. Needs previewToken, confirm=true and an idempotencyKey. Refuses if the tool's contract changed.`,
      input: { writeId: z.string().max(64), previewToken: z.string().max(128), idempotencyKey: z.string().max(128), confirm: z.literal(true) },
      run: async (a, c) => {
        await consent(c, ce);
        const r = await store.getResource<PendingWrite>(c, a.writeId, "agent_write");
        if (r.content.capability !== ce.capability) throw new AccessDenied("This preview belongs to a different capability.");
        const tool = toolNameFor(ce, "_commit");
        const prior = await store.getCommit(c, tool, a.idempotencyKey);
        if (prior) { if (prior.digest !== digest(r.content) || prior.resource_id !== r.id) throw new AccessDenied("idempotencyKey was already used for different content."); return { status: prior.status, result: prior.result, replayed: true }; }
        await registry.assertUnchanged(r.content.tool, ce.capability, r.content.fingerprint);
        const dg = await store.consumePreview(c, a.previewToken, "agent_write", r.id, r.version, r.content);
        const res = await store.commitOnce(c, tool, a.idempotencyKey, r.id, dg, async () => ({ result: await registry.call(r.content.tool, r.content.args) }), (e) => (e instanceof UpstreamToolError ? "failed" : "unknown"));
        return { ...res, note: res.status === "unknown" ? "Outcome unknown. It may have been applied. Check Workday; do not retry with a new key." : undefined };
      } }));
  }
  return out;
}
