# Workday identifiers in this repository

`src/catalog.ts` and `examples/workday-app-builder.mapping.json` contain 17 Workday tool names and WIDs. The tenant owner confirmed them as tenant-verified on 2026-11-08.

- **What they are:** catalog tool identifiers. Workday's docs describe copying a tool's WID from MCP Explorer or from the ASOR Agent Resource Search API, and passing it as `agent_resource.id` in an agent definition. The docs' own examples publish such WIDs.
- **What they are not:** worker, personal or tenant-account data, or credentials. This repository holds no worker IDs, personal data or tenant hostnames.
- **Tenant scope:** Workday's docs don't say whether these tool WIDs differ between tenants, and nothing here claims either way.
- **Redistribution:** the repository contains only names and IDs, not exported tool definitions, schemas or documentation. It makes no claim about a license to redistribute Workday material beyond that.
- **Runtime use:** reference only. Per Workday's change policy, tool names and schemas change without versioning, so live calls rely on discovery plus the approved tool policy, not on these names.

## Workday App Builder catalog (tenant-verified)

The 17 Workday App Builder tool names and WIDs in `src/catalog.ts` were supplied by the tenant owner, who confirmed them as tenant-verified on 2026-11-08. They are catalog tool IDs (the IDs MCP Explorer lists and an ASOR agent definition references), not personal or credential data. In Agent Gateway mode they are reference material only; live discovery and the approved tool policy decide what can be called. `examples/workday-app-builder.mapping.json` maps every capability to those exact tool names. Call `get_workday_catalog` to see each tool, its WID, the secured tool that exposes it, and whether it is mapped.

What is verified, and what is still open:

| Item | Status |
|---|---|
| Tool names and WIDs | Tenant-verified by the tenant owner |
| Input argument names | Not exported. Run `pnpm mapping:check` (read only: tools/list, no tool calls) and add `args` for inputs such as goalId, eventId, reviewId, and the write fields. Until then those capabilities stay gated and say which input is missing. |
| Response shapes | Not exported. Mined reads come back as bounded, quoted data. Identity (`find_staffing_workers`) and `goals_read` need `resultPath`/`fieldMap` taken from a recorded response. |
| Live calls from this repo | Not run yet |
| Self-evaluation submit | **Gap (confirmed 2026-11-09).** None of the 671 agent-ready MCP tools can submit a performance review self-evaluation (Initiation step `d8c892f4446c11de98360015c5e6daf6` of the Self Evaluation sub-process). `submit_task_type` fails "not a Tasks type event"; `submit_questionnaire` fails "Specify a questionnaire response"; underlying REST is `performanceEnablement` selfEvaluations submit with no MCP wrapper. **App Builder native:** `agents/prch-submit-skill` is a UI handoff (preview saved answers via self-evaluation and section read tools, explicit yes, deep link to the worker's own Complete Self Evaluation inbox task). **MCP gateway:** `commit_submission` for self reviews stays gated until mapped. |
| Peer feedback inside a review | **Gap.** `create_anytime_feedback_events` is anytime feedback, which is a separate object. |
| Reconciling an unknown write | **Gap.** There is no lookup by idempotency key. The user checks Workday. |

Secured tools: `collect_evidence` (Workday sources `wd_<tool>`, opt-in, reports ok/empty/access_denied), `get_my_open_review`, `get_review_period_suggestion`, `get_goal_status`, `get_my_review_step_status`, `preview_/commit_goal_update` (edit_worker_goals, then submit_worker_goal_events if chosen), `preview_/commit_anytime_feedback` (create_anytime_feedback_events; recipient must come from your own feedback request).

Repo-local Claude/MCP skills: `skills/performance-mine-skill`, `skills/performance-draft-skill`, `skills/performance-submit-skill`. Their `allowed-tools` list only these secured tools, never the raw upstream write names (a test enforces this).

Workday App Builder native agent package: `agents/` (`performance-review-cycle-helper.agent` and the `prch-*.agentskill` files, including `prch-submit-skill`).
