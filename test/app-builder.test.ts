import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setup } from "./helpers.js";
import { createFixtureBackend } from "../src/fixture-backend.js";
import { fixtureProviders, workdayProviders } from "../src/evidence.js";
import { APP_BUILDER_CATALOG, CATALOG_GAPS } from "../src/catalog.js";
import { CAPS } from "../src/capabilities.js";
import { connectUpstream, Gateway, scrub } from "../src/core/upstream.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadMapping } from "../src/core/config.js";

const SUPPLIED: Record<string, string> = {
  find_staffing_workers: "30aeb92af72e100063e2955a0eff0000", list_my_goals: "d1f2324877741000228b09b5517c0000", find_goal_status: "d1f23248777410001bd6e5668e370000",
  find_plan_assignments: "2f4851c51a2510001812306d343c0000", find_learning_transcript: "6276dc816f1210000db9b4d302680000", find_continue_learning: "c837d22835f710001a80d0f2b1f80000",
  find_worker_anytime_feedback_received: "b9aceb430909100019e7724376310000", find_anytime_feedback_events: "eb75070cf61c10001be4ebdd7e660000", find_performance_review: "22ebdd4f58f0100026e8e63439d40000",
  find_worker_performance_review_template: "c99d93695c4e100007b4dabf243b0000", find_worker_history_events: "0466c187aaa210007fd391ff62390000", find_business_process_tasks: "6b90a57837081000189e2b8fcf2b0000",
  find_business_process_event: "f7bf4be8d98210001f581ef563ef0000", find_remaining_steps_for_business_process_event: "4adc56576f4a100022927c2aba270000",
  create_anytime_feedback_events: "eb75070cf61c10001be53f0c493a0000", edit_worker_goals: "832f46b3b6f7100022da8ae967320000", submit_worker_goal_events: "832f46b3b6f7100022d97486b55d0000",
};

test("catalog preserves every tenant-verified name and WID exactly, and the mapping uses the same names", () => {
  assert.deepEqual(Object.fromEntries(APP_BUILDER_CATALOG.map((e) => [e.upstreamTool, e.wid])), SUPPLIED);
  const m = JSON.parse(readFileSync(new URL("../examples/workday-app-builder.mapping.json", import.meta.url), "utf8"));
  for (const e of APP_BUILDER_CATALOG) { assert.ok(CAPS[e.capability], e.capability); assert.equal(m.capabilities[e.capability].tool, e.upstreamTool); }
  assert.ok(!Object.values(m.capabilities).some((x: any) => /REPLACE/.test(x.tool)));
  assert.ok(!APP_BUILDER_CATALOG.some((e) => /self_evaluation|submit_business_process/.test(e.upstreamTool)));
  assert.match(CATALOG_GAPS[0], /self-evaluation/);
});

test("skill allowed-tools only name exposed secured tools, never raw upstream write names", async () => {
  const { app } = await setup();
  const exposed = new Set(app.tools.map((t) => t.name));
  for (const s of ["performance-mine-skill", "performance-draft-skill", "performance-submit-skill"]) {
    const md = readFileSync(new URL(`../skills/${s}/SKILL.md`, import.meta.url), "utf8");
    const line = md.match(/^allowed-tools:\s*(.+)$/m)![1];
    for (const t of line.split(",").map((x) => x.trim().replace(/^mcp__performance-review-cycle-helper__/, ""))) assert.ok(exposed.has(t), `${s}: ${t}`);
    assert.doesNotMatch(line, /create_anytime_feedback_events|edit_worker_goals|submit_worker_goal_events/);
  }
});

test("mine: Workday sources need opt-in, and access-denied is reported separately from empty", async () => {
  const be = createFixtureBackend();
  const { ok, call } = await setup({ backend: be, providers: (c) => [...fixtureProviders(c), ...workdayProviders(be)] });
  const denied = await call("emp_ava", "collect_evidence", { sourceIds: ["wd_find_learning_transcript"], from: "2026-07-01", to: "2026-07-02" });
  assert.equal(denied.ok, false);
  for (const s of ["wd_find_learning_transcript", "wd_find_plan_assignments"]) await ok("emp_ava", "set_evidence_source_opt_in", { sourceId: s, optIn: true });
  const cy = await ok("emp_ava", "get_my_review_cycle");
  const r = await ok("emp_ava", "collect_evidence", { sourceIds: ["wd_find_learning_transcript", "wd_find_plan_assignments"], from: cy.periodStart, to: cy.periodEnd });
  assert.deepEqual(r.sources.map((s: any) => s.status), ["ok", "empty"]);
  assert.equal(r.items[0].ref, "workday:find_learning_transcript");
});

test("mine: upstream 403 shows as access_denied", async () => {
  const be = createFixtureBackend();
  const { ok } = await setup({ backend: be, providers: () => workdayProviders(be) });
  await ok("emp_ben", "set_evidence_source_opt_in", { sourceId: "wd_find_worker_anytime_feedback_received", optIn: true });
  const cy = await ok("emp_ben", "get_my_review_cycle");
  const r = await ok("emp_ben", "collect_evidence", { sourceIds: ["wd_find_worker_anytime_feedback_received"], from: cy.periodStart, to: cy.periodEnd });
  assert.equal(r.sources[0].status, "access_denied");
});

test("review period comes from the active cycle and asks to confirm", async () => {
  const { ok } = await setup();
  const r = await ok("emp_ava", "get_review_period_suggestion");
  assert.equal(r.basis, "active review cycle"); assert.equal(r.confirmWithUser, true);
});

test("goal update: own goals only, full preview, single-use, idempotent edit then submit", async () => {
  const { ok, call } = await setup();
  const goals = await ok("emp_ava", "list_my_goals");
  const goalId = goals.goals[0].goalId;
  assert.equal((await call("emp_ava", "preview_goal_update", { goalId: "G-NOT-MINE", progressPercent: 10 })).ok, false);
  const p = await ok("emp_ava", "preview_goal_update", { goalId, progressPercent: 70, goalNote: "x".repeat(1500), submitAfterEdit: true });
  assert.equal(p.exactChange.goalNote.length, 1500);
  const args = { goalUpdateId: p.goalUpdateId, previewToken: p.previewToken, idempotencyKey: "key-goal-0001", confirm: true };
  const c1 = await ok("emp_ava", "commit_goal_update", args);
  assert.equal(c1.status, "succeeded"); assert.equal(c1.submit.status, "succeeded");
  const c2 = await ok("emp_ava", "commit_goal_update", args);
  assert.equal(c2.replayed, true);
  assert.equal((await call("emp_ava", "commit_goal_update", { ...args, confirm: false })).ok, false);
});

test("anytime feedback goes only to a colleague from your own feedback request", async () => {
  const { ok, call } = await setup();
  const reqs = await ok("emp_ava", "list_my_feedback_requests");
  if (!reqs.requests.length) return;
  const p = await ok("emp_ava", "preview_anytime_feedback", { feedbackRequestId: reqs.requests[0].requestId, feedbackText: "Thanks for the careful review." });
  assert.equal(p.exactSubmission.recipientWorkerId, reqs.requests[0].aboutWorkerId);
  assert.equal((await call("emp_ava", "preview_anytime_feedback", { feedbackRequestId: "nope", feedbackText: "x" })).ok, false);
  const c = await ok("emp_ava", "commit_anytime_feedback", { feedbackId: p.feedbackId, previewToken: p.previewToken, idempotencyKey: "key-afb-0001", confirm: true });
  assert.equal(c.status, "succeeded");
});

test("self-review submit stays gated with the App Builder mapping (no self-evaluation tool in catalog)", async () => {
  const server = new McpServer({ name: "up", version: "0" });
  for (const e of APP_BUILDER_CATALOG) server.tool(e.upstreamTool, "", { goalId: z.string().optional() }, async () => ({ content: [{ type: "text", text: "{}" }] }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
  const up = await connectUpstream({ transport: b });
  const m = loadMapping(fileURLToPath(new URL("../examples/workday-app-builder.mapping.json", import.meta.url)));
  const gw = await Gateway.create(up, m, CAPS);
  const st = Object.fromEntries(gw.capabilities().map((s) => [s.capability, s]));
  assert.equal(st.self_review_submit.status, "gated");
  assert.equal(st.wd_bp_tasks.status, "available");
  assert.equal(st.wd_goal_status.status, "gated"); assert.match(st.wd_goal_status.reason!, /goalId/);
  await up.close();
});

test("scrub removes tokens and emails from upstream errors", () => {
  const s = scrub("Bearer abc.def failed for jane@example.com key=" + "A".repeat(50));
  assert.doesNotMatch(s, /abc\.def|jane@|AAAA/);
});

test("audit redaction: long free text under any key, and JSON section payloads", async () => {
  const { redact } = await import("../src/core/audit.js");
  const r = redact({ sectionsJson: "[]", cycleId: "C-1", other: "x".repeat(200) }) as Record<string, string>;
  assert.equal(r.sectionsJson, "[REDACTED]"); assert.equal(r.cycleId, "C-1"); assert.match(r.other, /^\[REDACTED 200 chars\]$/);
});

test("oversized upstream result is refused before parsing", async () => {
  const server = new McpServer({ name: "up", version: "0" });
  server.tool("big", "", {}, async () => ({ content: [{ type: "text", text: JSON.stringify({ d: "x".repeat(1_100_000) }) }] }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
  const up = await connectUpstream({ transport: b });
  await assert.rejects(up.call("big", {}, 5000), /larger than/);
  await up.close();
});

test("upstream URL must be https except loopback", async () => {
  await assert.rejects(connectUpstream({ url: "http://evil.example.com/mcp", accessToken: "t" }), /https/);
});
