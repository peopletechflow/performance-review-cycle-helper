/** Supported modes per integration. Only fixtures are implemented; live mode refuses to start. */
export const ADAPTERS = [
  { domain: "review_cycle_read", system: "Workday Performance Management", read: "fixture", write: "n/a", note: "Candidate live read: Get_Employee_Reviews (Performance_Management web service). Needs tenant proof that results are limited to the signed-in worker." },
  { domain: "goals", system: "Workday goals", read: "fixture", write: "not_implemented", note: "Manage_Goals exists in the web service; goal edits are out of scope for this release." },
  { domain: "self_review_submit", system: "Workday employee review business process", read: "n/a", write: "live_unproven", note: "No documented operation was found for completing a worker's own self-evaluation inbox step as that worker. Import/Load/Start operations are integration tools, not this. Blocked until a tenant contract is proven." },
  { domain: "peer_feedback_submit", system: "Workday feedback", read: "n/a", write: "live_unproven", note: "Blocked until a tenant contract is proven." },
  { domain: "evidence", system: "Code host, docs, chat (any vendor)", read: "fixture", write: "n/a", note: "No live evidence connector is implemented. Each source must be opted in by the user." },
] as const;
