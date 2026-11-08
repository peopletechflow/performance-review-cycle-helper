/**
 * Workday App Builder tool catalog for the performance workflow.
 *
 * Status of each entry:
 * - Tool name and WID: supplied by the tenant owner and confirmed by them as tenant-verified (2026-11-08).
 *   These are catalog tool identifiers, the kind MCP Explorer and the ASOR Agent Resource Search API list and an ASOR
 *   agent definition references as agent_resource.id. They are not worker, personal or credential data. Workday's
 *   docs do not say whether a tool WID differs between tenants, so none is claimed either way.
 * - Use: reference only (get_workday_catalog, operator review). Workday's change policy says Agent-Ready tool names
 *   and schemas change without versioning and must not be hard-coded, so at runtime only live discovery plus the
 *   operator-approved tool policy decides what can be called (src/core/agentready.ts).
 * - Input and output schemas: not exported to this repo. The gateway reads each tool's input schema
 *   from tools/list at startup and gates any mapping that does not match. Response shapes are unknown,
 *   so mined records are returned as bounded, quoted data, and writes need a recognizable reference
 *   in the response (otherwise the outcome is "unknown" and must be reconciled).
 * - Live calls from this repo: not yet executed.
 */
export type CatalogEntry = { upstreamTool: string; wid: string; access: "read" | "write"; capability: string; skills: ("mine" | "draft" | "submit")[]; exposedVia: string[] };

export const CATALOG_PROVENANCE = { source: "Workday App Builder skill definitions supplied by the tenant owner", confirmedTenantVerified: "2026-11-08", schemasExported: false, liveExecutedFromThisRepo: false } as const;

export const APP_BUILDER_CATALOG: readonly CatalogEntry[] = [
  { upstreamTool: "find_staffing_workers", wid: "30aeb92af72e100063e2955a0eff0000", access: "read", capability: "identity", skills: ["mine", "submit"], exposedVia: ["(startup identity only; never exposed as a search tool)"] },
  { upstreamTool: "list_my_goals", wid: "d1f2324877741000228b09b5517c0000", access: "read", capability: "wd_goals", skills: ["mine"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_goal_status", wid: "d1f23248777410001bd6e5668e370000", access: "read", capability: "wd_goal_status", skills: ["mine"], exposedVia: ["get_goal_status"] },
  { upstreamTool: "find_plan_assignments", wid: "2f4851c51a2510001812306d343c0000", access: "read", capability: "wd_plan_assignments", skills: ["mine"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_learning_transcript", wid: "6276dc816f1210000db9b4d302680000", access: "read", capability: "wd_learning_transcript", skills: ["mine"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_continue_learning", wid: "c837d22835f710001a80d0f2b1f80000", access: "read", capability: "wd_continue_learning", skills: ["mine"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_worker_anytime_feedback_received", wid: "b9aceb430909100019e7724376310000", access: "read", capability: "wd_feedback_received", skills: ["mine", "draft"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_anytime_feedback_events", wid: "eb75070cf61c10001be4ebdd7e660000", access: "read", capability: "wd_feedback_given", skills: ["mine", "draft"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_performance_review", wid: "22ebdd4f58f0100026e8e63439d40000", access: "read", capability: "wd_performance_review", skills: ["mine", "draft", "submit"], exposedVia: ["get_my_open_review", "get_review_period_suggestion"] },
  { upstreamTool: "find_worker_performance_review_template", wid: "c99d93695c4e100007b4dabf243b0000", access: "read", capability: "wd_review_template", skills: ["mine", "draft"], exposedVia: ["get_my_open_review"] },
  { upstreamTool: "find_worker_history_events", wid: "0466c187aaa210007fd391ff62390000", access: "read", capability: "wd_history_events", skills: ["mine"], exposedVia: ["collect_evidence"] },
  { upstreamTool: "find_business_process_tasks", wid: "6b90a57837081000189e2b8fcf2b0000", access: "read", capability: "wd_bp_tasks", skills: ["submit"], exposedVia: ["get_my_review_step_status"] },
  { upstreamTool: "find_business_process_event", wid: "f7bf4be8d98210001f581ef563ef0000", access: "read", capability: "wd_bp_event", skills: ["submit"], exposedVia: ["get_my_review_step_status"] },
  { upstreamTool: "find_remaining_steps_for_business_process_event", wid: "4adc56576f4a100022927c2aba270000", access: "read", capability: "wd_bp_remaining_steps", skills: ["submit"], exposedVia: ["get_my_review_step_status"] },
  { upstreamTool: "create_anytime_feedback_events", wid: "eb75070cf61c10001be53f0c493a0000", access: "write", capability: "wd_anytime_feedback_create", skills: ["submit"], exposedVia: ["preview_anytime_feedback", "commit_anytime_feedback"] },
  { upstreamTool: "edit_worker_goals", wid: "832f46b3b6f7100022da8ae967320000", access: "write", capability: "wd_goal_edit", skills: ["submit"], exposedVia: ["preview_goal_update", "commit_goal_update"] },
  { upstreamTool: "submit_worker_goal_events", wid: "832f46b3b6f7100022d97486b55d0000", access: "write", capability: "wd_goal_submit", skills: ["submit"], exposedVia: ["commit_goal_update"] },
];

/** Known gaps in the supplied catalog. */
export const CATALOG_GAPS = [
  "No action that submits or completes the worker's own self-evaluation step is in the catalog. commit_submission for self reviews stays gated (capability self_review_submit) until the tenant names one. No generic business-process submit is used instead.",
  "No action that submits requested peer feedback inside a review is in the catalog (peer_feedback_submit stays gated). Anytime feedback (create_anytime_feedback_events) is a different object and is exposed separately.",
  "Input and output schemas were not exported. Argument names are read from tools/list at startup; response field paths for identity and goals must be set in the mapping (resultPath, fieldMap) from a recorded response.",
  "No tool to look up an anytime feedback event or goal event by idempotency key, so unknown write outcomes cannot be reconciled automatically; the user checks Workday.",
];
