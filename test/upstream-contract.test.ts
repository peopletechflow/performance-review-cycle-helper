/** Submission contract against a TEST DOUBLE upstream Workday MCP server (official SDK, invented responses). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectUpstream, Gateway, MappingFile } from "../src/core/upstream.js";
import { LiveBackend } from "../src/core/backend.js";
import { liveCaller } from "../src/core/identity.js";
import { CAPS } from "../src/capabilities.js";
import { setup } from "./helpers.js";

const txt = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o) }] });
async function live(submit: "ok" | "malformed", withSubmit = true) {
  const s = new McpServer({ name: "test-double-workday-mcp", version: "0" });
  const seen: any[] = []; const subs = new Map<string, string>();
  s.registerTool("whoami", { inputSchema: {} }, async () => txt({ tenantId: "tt", workerId: "W-1" }));
  s.registerTool("get_my_review_event", { inputSchema: {} }, async () => txt({ cycleId: "ER-1", name: "Test cycle", periodStart: "2026-07-01", periodEnd: "2026-12-31", selfReviewDue: "2026-12-15", peerFeedbackDue: "2026-12-10", templateSections: ["Impact"] }));
  s.registerTool("get_my_feedback_requests", { inputSchema: {} }, async () => txt({ requests: [] }));
  if (withSubmit) s.registerTool("complete_self_evaluation", { inputSchema: { review_event_id: z.string(), sections: z.string(), idempotency_key: z.string() } }, async (a) => { seen.push(a); subs.set(a.idempotency_key, "SE-1"); return submit === "ok" ? txt({ submissionRef: "SE-1", status: "pending_manager" }) : txt({ weird: true }); });
  s.registerTool("get_self_evaluation_by_key", { inputSchema: { idempotency_key: z.string() } }, async (a) => txt(subs.has(a.idempotency_key) ? { found: true, submissionRef: "SE-1" } : { found: false }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await s.connect(a);
  const gw = await Gateway.create(await connectUpstream({ transport: b }), MappingFile.parse({ version: 1, capabilities: {
    identity: { tool: "whoami" }, review_cycle_read: { tool: "get_my_review_event" }, feedback_requests_read: { tool: "get_my_feedback_requests" },
    self_review_submit: { tool: "complete_self_evaluation", args: { review_event_id: { from: "cycleId" }, sections: { from: "sectionsJson" }, idempotency_key: { from: "idempotencyKey" } } },
    submission_status: { tool: "get_self_evaluation_by_key", args: { idempotency_key: { from: "idempotencyKey" } } } } }), CAPS);
  const caller = liveCaller(await gw.invoke("identity", {}), { "tt:W-1": { roles: ["employee"] } });
  return { ...(await setup({ backend: new LiveBackend(gw), caller: () => caller, providers: () => [] })), seen, gw };
}
const sec = [{ heading: "Impact", text: "I own this text.", userAttested: true }];

test("live submit via mapped upstream tool with exact section payload", async () => {
  const s = await live("ok");
  const d = await s.ok("x", "save_draft", { kind: "self_review", sections: sec });
  const p = await s.ok("x", "preview_submission", { draftId: d.draftId });
  const c = await s.ok("x", "commit_submission", { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-live-1", confirm: true });
  assert.equal(c.status, "succeeded"); assert.equal(c.result.status, "pending_manager");
  assert.deepEqual(JSON.parse(s.seen[0].sections), [{ heading: "Impact", text: "I own this text.", evidenceIds: [] }]);
  assert.equal(s.seen[0].review_event_id, "ER-1");
});

test("contract mismatch -> unknown, replay does not resend, reconcile resolves", async () => {
  const s = await live("malformed");
  const d = await s.ok("x", "save_draft", { kind: "self_review", sections: sec });
  const p = await s.ok("x", "preview_submission", { draftId: d.draftId });
  const args = { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-live-2", confirm: true };
  assert.equal((await s.ok("x", "commit_submission", args)).status, "unknown");
  assert.equal((await s.ok("x", "commit_submission", args)).replayed, true); assert.equal(s.seen.length, 1);
  assert.equal((await s.ok("x", "reconcile_my_submission", { draftId: d.draftId, idempotencyKey: "key-live-2" })).status, "succeeded");
});

test("no upstream submit tool: capability gated, reads still work, goals gated independently", async () => {
  const s = await live("ok", false);
  assert.match(s.gw.capabilities().find((c) => c.capability === "self_review_submit")!.reason!, /not found/);
  assert.equal((await s.ok("x", "get_my_review_cycle")).cycleId, "ER-1");
  assert.equal(((await s.call("x", "list_my_goals")) as any).code, "gated");
  const d = await s.ok("x", "save_draft", { kind: "self_review", sections: sec });
  const p = await s.ok("x", "preview_submission", { draftId: d.draftId });
  assert.equal(p.submitAvailable, false);
  assert.equal(((await s.call("x", "commit_submission", { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-live-3", confirm: true })) as any).code, "gated");
});
