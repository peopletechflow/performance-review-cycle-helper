/**
 * MCP tools that let the LLM use runtime-discovered Workday Agent-Ready tools inside the approved policy.
 * Reads go straight through the registry. Writes are preview -> explicit confirm -> commit, bound to the
 * exact tool, arguments and contract fingerprint; a contract change between preview and commit sends nothing.
 */
import { z } from "zod";
import { AccessDenied, type Caller } from "./identity.js";
import { digest } from "./preview.js";
import type { Store } from "./store.js";
import { defineTool, type ToolDef } from "./tool.js";
import { untrusted, UNTRUSTED_NOTE } from "./untrusted.js";
import { UpstreamToolError } from "./upstream.js";
import type { AgentToolRegistry } from "./agentready.js";

type PendingWrite = { tool: string; fingerprint: string; args: Record<string, unknown> };
const Args = z.record(z.string(), z.unknown());

export function agentReadyTools(o: { registry: AgentToolRegistry; store: Store; perms: { read: string; draft: string; commit: string }; workerId: (c: Caller) => string }): ToolDef[] {
  const { registry, store } = o;
  return [
    defineTool({ name: "workday_list_agent_tools", kind: "read", permission: o.perms.read, description: "Workday Agent-Ready MCP tools you may use now: the operator-approved ones whose live contract still matches. Names, descriptions and schemas are discovered live and may change.", input: {},
      run: async () => { await registry.ensureFresh(); return { note: UNTRUSTED_NOTE, tools: registry.statuses().map((s) => ({ ...s, description: s.description === undefined ? undefined : untrusted(s.description.slice(0, 4000)) })) }; } }),
    defineTool({ name: "workday_read", kind: "read", permission: o.perms.read, description: "Call an approved read-only Workday Agent-Ready tool. Person arguments are filled from your own identity.", input: { tool: z.string().max(200), args: Args.default({}) },
      run: async (a, c) => ({ note: UNTRUSTED_NOTE, result: untrusted(JSON.stringify(await registry.read(a.tool, a.args, o.workerId(c))).slice(0, 60_000)) }) }),
    defineTool({ name: "workday_preview_write", kind: "propose", permission: o.perms.draft, description: "Prepare a call to an approved Workday Agent-Ready write tool. Returns the exact call for the user to read. Nothing is sent.", input: { tool: z.string().max(200), args: Args.default({}) },
      run: async (a, c) => {
        await registry.ensureFresh(true);
        const b = registry.buildArgs(a.tool, "write", a.args, o.workerId(c));
        const p: PendingWrite = { tool: a.tool, fingerprint: b.fingerprint, args: b.args };
        const r = await store.createResource(c, "agent_write", p, {}, "previewed");
        return { writeId: r.id, exactCall: p, ...(await store.issuePreview(c, "agent_write", r.id, r.version, p)), note: "Show the user this exact call in full. Commit only after they explicitly confirm it." };
      } }),
    defineTool({ name: "workday_commit_write", kind: "commit", permission: o.perms.commit, description: "Send a previewed write. Needs previewToken, confirm=true and an idempotencyKey. Refuses if the tool's contract changed since the preview.",
      input: { writeId: z.string().max(64), previewToken: z.string().max(128), idempotencyKey: z.string().max(128), confirm: z.literal(true) },
      run: async (a, c) => {
        const r = await store.getResource<PendingWrite>(c, a.writeId, "agent_write");
        const tool = "workday_commit_write";
        const prior = await store.getCommit(c, tool, a.idempotencyKey);
        if (prior) { if (prior.digest !== digest(r.content) || prior.resource_id !== r.id) throw new AccessDenied("idempotencyKey was already used for different content."); return { status: prior.status, result: prior.result, replayed: true }; }
        await registry.assertUnchanged(r.content.tool, r.content.fingerprint);
        const dg = await store.consumePreview(c, a.previewToken, "agent_write", r.id, r.version, r.content);
        const out = await store.commitOnce(c, tool, a.idempotencyKey, r.id, dg, async () => ({ result: await registry.call(r.content.tool, r.content.args) }), (e) => (e instanceof UpstreamToolError ? "failed" : "unknown"));
        return { ...out, note: out.status === "unknown" ? "Outcome unknown. It may have been applied. Check Workday; do not retry with a new key." : undefined };
      } }),
  ];
}
