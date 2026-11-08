import { z } from "zod";
import { IDENTITY_CAPABILITY, type CapabilityDef } from "./core/upstream.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const short = (n = 200) => z.string().min(1).max(n);
const submitOut = z.object({ submissionRef: short(128), status: z.enum(["submitted", "in_progress", "pending_manager"]) }).strip();

/** Our task contracts for an upstream Workday MCP server. Tenants map each to an upstream tool; unmapped ones are gated. */
export const CAPS: Record<string, CapabilityDef> = {
  identity: IDENTITY_CAPABILITY,
  review_cycle_read: { kind: "read", inputs: [], description: "Caller's current review event", output: z.object({
    cycleId: short(128), name: short(), periodStart: date, periodEnd: date, selfReviewDue: date, peerFeedbackDue: date, templateSections: z.array(short()).min(1).max(20) }).strip() },
  goals_read: { kind: "read", inputs: [], description: "Caller's goals", output: z.object({ goals: z.array(z.object({ goalId: short(128), title: short(300), status: short(40) }).strip()).max(50) }).strip() },
  feedback_requests_read: { kind: "read", inputs: [], description: "Feedback the caller was asked to give", output: z.object({
    requests: z.array(z.object({ requestId: short(128), aboutDisplayName: short(), questions: z.array(short(500)).min(1).max(10) }).strip()).max(50) }).strip() },
  self_review_submit: { kind: "write", inputs: ["cycleId", "sectionsJson", "idempotencyKey"], description: "Submit the caller's self evaluation step", output: submitOut },
  peer_feedback_submit: { kind: "write", inputs: ["feedbackRequestId", "sectionsJson", "idempotencyKey"], description: "Submit requested feedback", output: submitOut },
  submission_status: { kind: "read", inputs: ["idempotencyKey"], description: "Find a submission by idempotency key", output: z.object({ found: z.boolean(), submissionRef: short(128).optional(), status: short(40).optional() }).strip() },
};
