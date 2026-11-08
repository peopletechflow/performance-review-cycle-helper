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
    feedback_requests_read: (_i, c) => ({ requests: FEEDBACK_REQUESTS.filter((r) => r.tenantId === c.tenantId && r.reviewerId === c.userId).map((r) => ({ requestId: r.requestId, aboutDisplayName: USERS[r.subjectId]?.displayName ?? "colleague", questions: r.questions })) }),
    self_review_submit: submit, peer_feedback_submit: submit,
    submission_status: (i, c) => { const r = subs.get(k(c.tenantId, c.userId, i.idempotencyKey)); return r ? { found: true, submissionRef: r, status: "submitted" } : { found: false }; },
  });
}
