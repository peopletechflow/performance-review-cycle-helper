import { z } from "zod";
import { IDENTITY_CAPABILITY, type CapabilityDef } from "./core/upstream.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const short = (n = 200) => z.string().min(1).max(n);
const submitOut = z.object({ submissionRef: short(128), status: z.enum(["submitted", "in_progress", "pending_manager"]) }).strip();

/** Our task contracts for an upstream Workday MCP server. Tenants map each to an upstream tool; unmapped ones are gated. */
/** Response shape not exported: accept any JSON up to 64 KB, return it only as quoted data. Never used for identity, permissions or write decisions. */
const raw = (inputs: string[], description: string): CapabilityDef => ({ kind: "read", inputs, description, output: z.unknown().refine((v) => v !== undefined && JSON.stringify(v).length <= 65_536, "response missing or over 64 KB") });
const writeRef = z.object({ ref: short(256) }).strip();

export const CAPS: Record<string, CapabilityDef> = {
  identity: IDENTITY_CAPABILITY,
  review_cycle_read: { kind: "read", inputs: [], description: "Caller's current review event", output: z.object({
    cycleId: short(128), name: short(), periodStart: date, periodEnd: date, selfReviewDue: date, peerFeedbackDue: date, templateSections: z.array(short()).min(1).max(20) }).strip() },
  goals_read: { kind: "read", inputs: [], description: "Caller's goals", output: z.object({ goals: z.array(z.object({ goalId: short(128), title: short(300), status: short(40) }).strip()).max(50) }).strip() },
  feedback_requests_read: { kind: "read", inputs: [], description: "Feedback the caller was asked to give", output: z.object({
    requests: z.array(z.object({ requestId: short(128), aboutDisplayName: short(), aboutWorkerId: short(128).optional(), questions: z.array(short(500)).min(1).max(10) }).strip()).max(50) }).strip() },
  self_review_submit: { kind: "write", inputs: ["cycleId", "sectionsJson", "idempotencyKey"], description: "Submit the caller's self evaluation step", output: submitOut },
  peer_feedback_submit: { kind: "write", inputs: ["feedbackRequestId", "sectionsJson", "idempotencyKey"], description: "Submit requested feedback", output: submitOut },
  wd_goals: raw(["from", "to"], "list_my_goals"),
  wd_goal_status: raw(["goalId"], "find_goal_status"),
  wd_plan_assignments: raw(["from", "to"], "find_plan_assignments"),
  wd_learning_transcript: raw(["from", "to"], "find_learning_transcript"),
  wd_continue_learning: raw(["from", "to"], "find_continue_learning"),
  wd_feedback_received: raw(["from", "to"], "find_worker_anytime_feedback_received"),
  wd_feedback_given: raw(["from", "to"], "find_anytime_feedback_events"),
  wd_performance_review: raw([], "find_performance_review"),
  wd_review_template: raw(["reviewId"], "find_worker_performance_review_template"),
  wd_history_events: raw(["from", "to"], "find_worker_history_events"),
  wd_bp_tasks: raw([], "find_business_process_tasks"),
  wd_bp_event: raw(["eventId"], "find_business_process_event"),
  wd_bp_remaining_steps: raw(["eventId"], "find_remaining_steps_for_business_process_event"),
  wd_anytime_feedback_create: { kind: "write", inputs: ["recipientWorkerId", "feedbackText", "idempotencyKey"], description: "create_anytime_feedback_events", output: writeRef },
  wd_goal_edit: { kind: "write", inputs: ["goalId", "progressPercent", "goalNote", "idempotencyKey"], description: "edit_worker_goals", output: writeRef },
  wd_goal_submit: { kind: "write", inputs: ["goalId", "idempotencyKey"], description: "submit_worker_goal_events", output: writeRef },
  review_template_read: { kind: "read", inputs: ["reviewId"], description: "Normalized template with rating scales (needs a verified fieldMap)", output: z.object({
    sections: z.array(z.object({ name: short(), ratingScale: z.array(short(80)).min(2).max(20).optional() }).strip()).min(1).max(30) }).strip() },
  submission_status: { kind: "read", inputs: ["idempotencyKey"], description: "Find a submission by idempotency key", output: z.object({ found: z.boolean(), submissionRef: short(128).optional(), status: short(40).optional() }).strip() },
};
