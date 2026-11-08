import { UpstreamToolError } from "./core/upstream.js";
import { FixtureBackend } from "./core/backend.js";
import { CAPS } from "./capabilities.js";
import { CYCLES, FEEDBACK_REQUESTS, GOALS, USERS } from "./fixtures/data.js";

/** EXAMPLE DATA ONLY, behind the same capability contracts as live. */
export function createFixtureBackend(): FixtureBackend {
  const subs = new Map<string, string>();
  const k = (t: string, u: string, key: unknown) => `${t}:${u}:${String(key)}`;
  const submit = (i: Record<string, unknown>, c: { tenantId: string; userId: string }) => { const ref = `FIXTURE-SUB-${String(i.idempotencyKey).slice(0, 8)}`; subs.set(k(c.tenantId, c.userId, i.idempotencyKey), ref); return { submissionRef: ref, status: "submitted" }; };
  return new FixtureBackend(CAPS, {
    identity: (_i, c) => ({ tenantId: c.tenantId, workerId: c.userId }),
    review_cycle_read: (_i, c) => { const cy = CYCLES[c.tenantId]; return { ...cy, templateSections: cy.template.sections }; },
    goals_read: (_i, c) => ({ goals: GOALS[c.userId] ?? [] }),
    feedback_requests_read: (_i, c) => ({ requests: FEEDBACK_REQUESTS.filter((r) => r.tenantId === c.tenantId && r.reviewerId === c.userId).map((r) => ({ requestId: r.requestId, aboutDisplayName: USERS[r.subjectId]?.displayName ?? "colleague", aboutWorkerId: r.subjectId, questions: r.questions })) }),
    self_review_submit: submit, peer_feedback_submit: submit,
    // EXAMPLE responses for the App Builder catalog capabilities (shapes invented for tests, not Workday schemas).
    wd_goals: (_i, c) => ({ data: (GOALS[c.userId] ?? []).map((g) => ({ id: g.goalId, descriptor: g.title, status: g.status, lastUpdated: "2026-09-30" })) }),
    wd_goal_status: (i) => ({ id: i.goalId, percentComplete: 60, asOf: "2026-10-01" }),
    wd_plan_assignments: () => ({ data: [] }),
    wd_learning_transcript: (_i, c) => ({ data: c.userId === "emp_ava" ? [{ id: "LRN-EX-1", course: "Example course: incident review", completedOn: "2026-08-02" }] : [] }),
    wd_continue_learning: () => ({ data: [] }),
    wd_feedback_received: (_i, c) => { if (c.userId === "emp_ben") throw new UpstreamToolError("Workday MCP returned an error for wd_feedback_received: 403 Forbidden"); return { data: c.userId === "emp_ava" ? [{ id: "FB-EX-1", from: "Example colleague", date: "2026-09-12", comment: "Example feedback text." }] : [] }; },
    wd_feedback_given: () => ({ data: [] }),
    wd_performance_review: (_i, c) => ({ data: [{ id: "REV-EX-1", descriptor: CYCLES[c.tenantId].name, periodStart: CYCLES[c.tenantId].periodStart, periodEnd: CYCLES[c.tenantId].periodEnd, eventId: "BPE-EX-1" }] }),
    wd_review_template: (_i, c) => ({ sections: CYCLES[c.tenantId].template.sections }),
    wd_history_events: () => ({ data: [] }),
    wd_bp_tasks: () => ({ data: [{ id: "TASK-EX-1", descriptor: "Example self evaluation task", eventId: "BPE-EX-1" }] }),
    wd_bp_event: (i) => ({ id: i.eventId, status: "In Progress" }),
    wd_bp_remaining_steps: () => ({ data: [{ step: "Example self evaluation" }, { step: "Example manager evaluation" }] }),
    review_template_read: (_i, c) => ({ sections: CYCLES[c.tenantId].template.sections.map((n, k) => (k === 0 ? { name: n, ratingScale: ["Example level 1", "Example level 2", "Example level 3"] } : { name: n })) }),
    wd_anytime_feedback_create: (i) => ({ ref: `FIXTURE-AFB-${String(i.idempotencyKey).slice(0, 8)}` }),
    wd_goal_edit: (i) => ({ ref: `FIXTURE-GE-${String(i.goalId)}` }),
    wd_goal_submit: (i) => ({ ref: `FIXTURE-GS-${String(i.goalId)}` }),
    submission_status: (i, c) => { const r = subs.get(k(c.tenantId, c.userId, i.idempotencyKey)); return r ? { found: true, submissionRef: r, status: "submitted" } : { found: false }; },
  });
}
