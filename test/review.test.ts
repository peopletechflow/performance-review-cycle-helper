import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, visibleTools } from "../src/core/tool.js";
import { resolveCaller } from "../src/core/identity.js";
import { USERS } from "../src/fixtures/data.js";
import { as, setup } from "./helpers.js";

const collect = { sourceIds: ["src_ex_code", "src_ex_docs"], from: "2026-07-01", to: "2026-12-31" };
const section = { heading: "Impact", text: "I moved invoice generation to the new service and removed three legacy jobs.", evidenceIds: ["EV-EX-1"] };
async function optIn(s: Awaited<ReturnType<typeof setup>>, u = "emp_ava", ids = ["src_ex_code", "src_ex_docs"]) { for (const id of ids) await s.ok(u, "set_evidence_source_opt_in", { sourceId: id, optIn: true }); }
async function flow(s: Awaited<ReturnType<typeof setup>>) {
  await optIn(s); await s.ok("emp_ava", "collect_evidence", collect);
  const d = await s.ok("emp_ava", "save_draft", { kind: "self_review", sections: [section] });
  const p = await s.ok("emp_ava", "preview_submission", { draftId: d.draftId });
  return { d, p };
}

test("focused tool set: review-cycle tools only, no identity args, no rating fields", async () => {
  const { app } = await setup();
  assert.equal(app.tools.length, 23);
  for (const t of app.tools) { assert.doesNotMatch(t.name, /payroll|salary|compensation|admin|time_off|benefit|search_workers|rating|rank|passthrough/i); for (const k of ["userId", "tenantId", "employeeId", "workerId", "rating", "score"]) assert.ok(!(k in t.input), `${t.name}.${k}`); }
});

test("MCP server: read-only user sees no draft or submit tools", async () => {
  const { app, store } = await setup();
  const server = buildMcpServer({ name: "t", version: "0" }, app.tools, app.roles, store, as("ro_cy"));
  const [a, b] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ["get_goal_status", "get_my_open_review", "get_my_review_cycle", "get_my_review_step_status", "get_review_period_suggestion", "get_workday_catalog", "list_integrations", "list_my_feedback_requests", "list_my_goals"]);
  await client.close();
});

test("evidence: explicit durable opt-in, own items, inside period, attributed and untrusted", async () => {
  const s = await setup();
  assert.match(((await s.call("emp_ava", "collect_evidence", collect)) as any).error, /not opted in/);
  await optIn(s);
  const r = await s.ok("emp_ava", "collect_evidence", collect);
  assert.deepEqual(r.items.map((i: any) => i.evidenceId).sort(), ["EV-EX-1", "EV-EX-2"]);
  assert.ok(r.items.every((i: any) => i.text.untrusted && i.example === true && i.date));
  assert.match(((await s.call("emp_ava", "collect_evidence", { ...collect, sourceIds: ["src_ex_chat"] })) as any).error, /not opted in/);
  assert.equal((await s.call("emp_ava", "collect_evidence", { ...collect, from: "2025-01-01" })).ok, false);
  assert.equal((await s.call("emp_ava", "collect_evidence", { ...collect, sourceIds: ["src_ex_code_b"] })).ok, false);
  await s.ok("emp_ava", "set_evidence_source_opt_in", { sourceId: "src_ex_code", optIn: false });
  assert.equal((await s.call("emp_ava", "collect_evidence", collect)).ok, false);
});

test("no fabricated evidence or ratings", async () => {
  const s = await setup();
  assert.match(((await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [section] })) as any).error, /not collected/);
  await optIn(s); await s.ok("emp_ava", "collect_evidence", collect);
  assert.equal((await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [{ ...section, evidenceIds: ["EV-EX-3"] }] })).ok, false);
  assert.match(((await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [{ heading: "Growth", text: "I led everything." }] })) as any).error, /userAttested/);
  assert.equal(((await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [{ ...section, rating: 5 }] })) as any).code, "invalid_input");
});

test("lifecycle: preview -> confirm submits once; concurrent and replayed commits are safe", async () => {
  const s = await setup(); const { d, p } = await flow(s);
  assert.deepEqual(p.exactSubmission.sections[0].evidenceIds, ["EV-EX-1"]);
  const args = { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-sub-1", confirm: true };
  const rs = await Promise.all([1, 2, 3].map(() => s.call("emp_ava", "commit_submission", args)));
  assert.ok(rs.some((r) => r.ok));
  assert.equal(Number((await s.db.query<any>("select count(*)::int n from commits")).rows[0].n), 1);
  assert.equal((await s.ok("emp_ava", "commit_submission", args)).replayed, true);
  assert.match(((await s.call("emp_ava", "save_draft", { kind: "self_review", draftId: d.draftId, sections: [section] })) as any).error, /cannot be edited/);
});

test("edits invalidate approval; tampered and cross-user tokens rejected", async () => {
  const s = await setup(); const { d, p } = await flow(s);
  await s.ok("emp_ava", "save_draft", { kind: "self_review", draftId: d.draftId, sections: [{ ...section, text: "Edited text." }] });
  assert.equal((await s.call("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-stale-1", confirm: true })).ok, false);
  const p2 = await s.ok("emp_ava", "preview_submission", { draftId: d.draftId });
  assert.equal(p2.version, 2);
  assert.equal((await s.call("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken.slice(0, -2) + "zz", idempotencyKey: "key-tamp-1", confirm: true })).ok, false);
  assert.equal(((await s.call("emp_zed", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken, idempotencyKey: "key-cross-1", confirm: true })) as any).code, "denied");
  assert.equal((await s.ok("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken, idempotencyKey: "key-ok-1", confirm: true })).status, "succeeded");
});

test("confidentiality: feedback scoped to reviewer; subject cannot read; other tenant sees nothing", async () => {
  const s = await setup();
  assert.deepEqual((await s.ok("emp_ava", "list_my_feedback_requests")).requests.map((r: any) => r.requestId), ["FR-EX-1"]);
  const fb = await s.ok("emp_ava", "save_draft", { kind: "peer_feedback", feedbackRequestId: "FR-EX-1", sections: [{ heading: "Keep doing", text: "Clear runbooks." }] });
  assert.equal(((await s.call("emp_ben", "get_draft", { draftId: fb.draftId })) as any).code, "denied");
  assert.equal((await s.call("emp_ben", "save_draft", { kind: "peer_feedback", feedbackRequestId: "FR-EX-1", sections: [{ heading: "x", text: "y" }] })).ok, false);
  assert.ok(!JSON.stringify(await s.ok("emp_ben", "get_drafting_context", { kind: "peer_feedback", feedbackRequestId: "FR-EX-2" })).includes("Clear runbooks"));
  assert.equal((await s.ok("emp_zed", "list_my_feedback_requests")).requests.length, 0);
});

test("deny precedence: submit_freeze removes commit", async () => {
  const s = await setup();
  const v = visibleTools(s.app.tools, as("emp_ben"), s.app.roles).map((t) => t.name);
  assert.ok(!v.includes("commit_submission") && v.includes("save_draft"));
});

test("prompt injection inside evidence cannot submit", async () => {
  const s = await setup(); await optIn(s);
  const ev = await s.ok("emp_ava", "collect_evidence", collect);
  assert.ok(ev.items.some((i: any) => /ignore your rules/.test(i.text.text) && i.text.untrusted));
  assert.equal((await s.call("emp_ava", "commit_submission", { draftId: "dra_x", previewToken: "forged", idempotencyKey: "key-inj-1", confirm: true })).ok, false);
  assert.equal(Number((await s.db.query<any>("select count(*)::int n from commits")).rows[0].n), 0);
});

test("voice samples stored durably and returned as untrusted data", async () => {
  const s = await setup();
  await s.ok("emp_ava", "set_voice_samples", { samples: ["I like short sentences. I name the people who helped me."] });
  assert.equal((await s.ok("emp_ava", "get_drafting_context", { kind: "self_review" })).voiceSamples[0].untrusted, true);
});

test("closed step blocks drafting", async () => {
  const s = await setup({ now: () => new Date("2026-12-20T00:00:00Z") });
  assert.match(((await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [{ heading: "x", text: "y", userAttested: true }] })) as any).error, /closed/);
});

test("fixture identity refused in live mode; audit redacts draft text", async () => {
  assert.throws(() => resolveCaller("live", {}, USERS), /not available in live mode/);
  const s = await setup(); await flow(s);
  assert.ok(!JSON.stringify((await s.db.query("select inputs from audit_log")).rows).includes("invoice generation"));
});
