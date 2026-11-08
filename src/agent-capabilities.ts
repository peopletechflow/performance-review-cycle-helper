import type { Ceiling } from "./core/agentready.js";
/**
 * Capability ceilings for Workday Agent-Ready tools in this project. Operator tool policy can bind discovered
 * tools to these, never to anything else. Writes stay disabled until a scoped adapter with a tenant-verified ownership contract exists
 * (self-evaluation submit has no known tool at all).
 */
export const AGENT_CEILINGS: readonly Ceiling[] = [
  { capability: "review.self.read", access: "read", permission: "rc.read", description: "Read your own performance review records", enabled: true },
  { capability: "goals.self.read", access: "read", permission: "rc.read", description: "Read your own goals", enabled: true },
  { capability: "bp.self.read", access: "read", permission: "rc.read", description: "Read your own review business-process tasks", enabled: true },
  { capability: "feedback.self.read", access: "read", permission: "rc.evidence.read", description: "Read feedback you received or gave", enabled: true, consent: "evidence:workday_agent" },
  { capability: "learning.self.read", access: "read", permission: "rc.evidence.read", description: "Read your own learning records", enabled: true, consent: "evidence:workday_agent" },
  { capability: "goal.self.update", access: "write", permission: "rc.submit", description: "Update one of your own goals", enabled: false },
  { capability: "feedback.give", access: "write", permission: "rc.submit", description: "Give feedback to a colleague", enabled: false },
  { capability: "self_review.submit", access: "write", permission: "rc.submit", description: "Submit your self evaluation", enabled: false },
];
