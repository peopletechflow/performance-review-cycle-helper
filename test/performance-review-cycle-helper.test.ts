import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveCaller, type Caller } from "../src/core/identity.js";
import { buildMcpServer, callTool, visibleTools } from "../src/core/tool.js";
import { Audit } from "../src/core/audit.js";
import { USERS } from "../src/fixtures/data.js";
import { createPerformanceReviewCycleHelper } from "../src/tools.js";

const as = (u: string): Caller => resolveCaller("fixture", { FIXTURE_USER: u }, USERS);
const NOW = () => new Date("2026-11-08T12:00:00Z");
function setup(mode: "fixture" | "live" = "fixture", now = NOW) {
  const app = createPerformanceReviewCycleHelper(mode, { now }); const audit = new Audit();
  const call = (u: string, name: string, args: unknown = {}) => callTool(app.tools, app.roles, audit, as(u), name, args);
  const ok = async (u: string, name: string, args: unknown = {}) => { const r = await call(u, name, args); assert.ok(r.ok, JSON.stringify(r)); return (r as any).data; };
  return { app, audit, call, ok };
}
const collect = { sourceIds: ["src_ex_code", "src_ex_docs"], from: "2026-07-01", to: "2026-12-31" };
const section = { heading: "Impact", text: "I moved invoice generation to the new service and removed three legacy jobs.", evidenceIds: ["EV-EX-1"] };

async function submittedFlow(s: ReturnType<typeof setup>) {
  await s.ok("emp_ava", "collect_evidence", collect);
  const d = await s.ok("emp_ava", "save_draft", { kind: "self_review", sections: [section] });
  const p = await s.ok("emp_ava", "preview_submission", { draftId: d.draftId });
  return { d, p };
}

test("focused tool set: review-cycle tools only, no user/tenant args, no ratings fields", () => {
  const { app } = setup();
  const names = app.tools.map((t) => t.name);
  assert.equal(names.length, 12);
  for (const n of names) assert.doesNotMatch(n, /payroll|salary|compensation|admin|time_off|benefit|search_workers|rating|rank|passthrough/i);
  for (const t of app.tools) for (const k of ["userId", "tenantId", "employeeId", "rating", "score"]) assert.ok(!(k in t.input), `${t.name}.${k}`);
});

test("MCP server: readonly user sees no draft or submit tools", async () => {
  const { app } = setup();
  const server = buildMcpServer({ name: "t", version: "0" }, app.tools, app.roles, new Audit(), as("ro_cy"));
  const [a, b] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_my_review_cycle", "list_integrations", "list_my_feedback_requests", "list_my_goals"]);
  await client.close();
});

test("evidence: only opted-in sources, own items, inside the period; attributed and marked untrusted", async () => {
  const { ok, call } = setup();
  const r = await ok("emp_ava", "collect_evidence", collect);
  assert.deepEqual(r.items.map((i: any) => i.evidenceId).sort(), ["EV-EX-1", "EV-EX-2"]);
  assert.ok(r.items.every((i: any) => i.text.untrusted && i.ref.startsWith("fixture://") && i.date));
  const chat = await call("emp_ava", "collect_evidence", { ...collect, sourceIds: ["src_ex_chat"] });
  assert.match((chat as any).error, /not opted in/);
  const wide = await call("emp_ava", "collect_evidence", { ...collect, from: "2025-01-01" });
  assert.equal(wide.ok, false);
  const otherSource = await call("emp_ava", "collect_evidence", { ...collect, sourceIds: ["src_ex_code_b"] });
  assert.equal(otherSource.ok, false);
});

test("no fabricated evidence: citing uncollected items or uncited claims is rejected", async () => {
  const { ok, call } = setup();
  const r1 = await call("emp_ava", "save_draft", { kind: "self_review", sections: [section] });
  assert.match((r1 as any).error, /not collected/);
  await ok("emp_ava", "collect_evidence", collect);
  const r2 = await call("emp_ava", "save_draft", { kind: "self_review", sections: [{ ...section, evidenceIds: ["EV-EX-3"] }] });
  assert.equal(r2.ok, false);
  const r3 = await call("emp_ava", "save_draft", { kind: "self_review", sections: [{ heading: "Growth", text: "I led everything." }] });
  assert.match((r3 as any).error, /userAttested/);
  const r4 = await call("emp_ava", "save_draft", { kind: "self_review", sections: [{ ...section, rating: 5 }] });
  assert.equal((r4 as any).code, "invalid_input");
  await ok("emp_ava", "save_draft", { kind: "self_review", sections: [{ heading: "Growth", text: "I mentored a new teammate.", userAttested: true }] });
});

test("lifecycle: preview -> confirm submits once; replay returns same ref; concurrency safe", async () => {
  const s = setup(); const { d, p } = await submittedFlow(s);
  assert.deepEqual(p.exactSubmission.sections[0].evidenceIds, ["EV-EX-1"]);
  const args = { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-sub-1", confirm: true };
  const rs = await Promise.all([1, 2, 3].map(() => s.ok("emp_ava", "commit_submission", args)));
  assert.equal(new Set(rs.map((r) => r.submissionRef)).size, 1);
  assert.equal(s.app.submissions.length, 1);
  const again = await s.ok("emp_ava", "commit_submission", args); assert.equal(again.replayed, true);
  const edit = await s.call("emp_ava", "save_draft", { kind: "self_review", draftId: d.draftId, sections: [section] });
  assert.match((edit as any).error, /cannot be edited/);
});

test("edits invalidate approval; tampered and cross-user tokens are rejected; reused key with new content rejected", async () => {
  const s = setup(); const { d, p } = await submittedFlow(s);
  await s.ok("emp_ava", "save_draft", { kind: "self_review", draftId: d.draftId, sections: [{ ...section, text: "Edited text." }] });
  const stale = await s.call("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-stale-1", confirm: true });
  assert.equal(stale.ok, false);
  const p2 = await s.ok("emp_ava", "preview_submission", { draftId: d.draftId });
  assert.equal(p2.version, 2);
  const tampered = await s.call("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken.slice(0, -2) + "zz", idempotencyKey: "key-tamp-1", confirm: true });
  assert.equal(tampered.ok, false);
  const cross = await s.call("emp_zed", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken, idempotencyKey: "key-cross-1", confirm: true });
  assert.equal((cross as any).code, "denied");
  const done = await s.ok("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p2.previewToken, idempotencyKey: "key-ok-1", confirm: true });
  assert.equal(done.version, 2);
});

test("confidentiality: peer feedback is scoped to the reviewer; subject cannot read it; other tenant sees nothing", async () => {
  const s = setup();
  const reqs = await s.ok("emp_ava", "list_my_feedback_requests");
  assert.deepEqual(reqs.requests.map((r: any) => r.requestId), ["FR-EX-1"]);
  const fb = await s.ok("emp_ava", "save_draft", { kind: "peer_feedback", feedbackRequestId: "FR-EX-1", sections: [{ heading: "Keep doing", text: "Clear runbooks." }] });
  const peek = await s.call("emp_ben", "get_draft", { draftId: fb.draftId });
  assert.equal((peek as any).code, "denied");
  const steal = await s.call("emp_ben", "save_draft", { kind: "peer_feedback", feedbackRequestId: "FR-EX-1", sections: [{ heading: "x", text: "y" }] });
  assert.equal(steal.ok, false);
  const ctx = await s.ok("emp_ben", "get_drafting_context", { kind: "peer_feedback", feedbackRequestId: "FR-EX-2" });
  assert.ok(!JSON.stringify(ctx).includes("Clear runbooks"));
  const zed = await s.ok("emp_zed", "list_my_feedback_requests"); assert.equal(zed.requests.length, 0);
});

test("deny precedence: submit_freeze removes commit even though employee grants it", async () => {
  const s = setup();
  assert.ok(!visibleTools(s.app.tools, as("emp_ben"), s.app.roles).some((t) => t.name === "commit_submission"));
  assert.ok(visibleTools(s.app.tools, as("emp_ben"), s.app.roles).some((t) => t.name === "save_draft"));
});

test("prompt injection inside evidence cannot submit or rate", async () => {
  const s = setup();
  const ev = await s.ok("emp_ava", "collect_evidence", collect);
  assert.ok(ev.items.some((i: any) => /ignore your rules/.test(i.text.text) && i.text.untrusted));
  const ctx = await s.ok("emp_ava", "get_drafting_context", { kind: "self_review" });
  assert.ok(ctx.rules.some((r: string) => /ratings/.test(r)));
  const r = await s.call("emp_ava", "commit_submission", { draftId: "dr_x", previewToken: "forged", idempotencyKey: "key-inj-1", confirm: true });
  assert.equal(r.ok, false); assert.equal(s.app.submissions.length, 0);
});

test("voice samples are stored as data and returned marked untrusted", async () => {
  const s = setup();
  await s.ok("emp_ava", "set_voice_samples", { samples: ["I like short sentences. I name the people who helped me."] });
  const ctx = await s.ok("emp_ava", "get_drafting_context", { kind: "self_review" });
  assert.equal(ctx.voiceSamples[0].untrusted, true);
});

test("closed step blocks drafting and preview", async () => {
  const s = setup("fixture", () => new Date("2026-12-20T00:00:00Z"));
  const r = await s.call("emp_ava", "save_draft", { kind: "self_review", sections: [{ heading: "x", text: "y", userAttested: true }] });
  assert.match((r as any).error, /closed/);
});

test("live mode fails closed for sign-in, reads, and submission", async () => {
  assert.throws(() => resolveCaller("live", {}, USERS), /not available in live mode/);
  const s = setup("live");
  assert.equal(((await s.call("emp_ava", "get_my_review_cycle")) as any).code, "live_unsupported");
});

test("no outbound network calls in the full flow; audit has no draft text", async () => {
  const orig = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("blocked"); }) as typeof fetch;
  const s = setup();
  try { const { d, p } = await submittedFlow(s); await s.ok("emp_ava", "commit_submission", { draftId: d.draftId, previewToken: p.previewToken, idempotencyKey: "key-net-1", confirm: true }); }
  finally { globalThis.fetch = orig; }
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(s.audit.events).includes("invoice generation"));
});
