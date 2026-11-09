# Changelog

## Unreleased: App Builder native self-evaluation submit

- Added Workday App Builder native agent package under `agents/`: `performance-review-cycle-helper.agent` plus `prch-submit-skill`, `prch-goals-skill`, `prch-draft-skill`, `prch-mine-skill` and `prch-review-status-skill`.
- `prch-submit-skill` submits the signed-in worker's own awaiting Complete Self Evaluation step via `find_performance_review_self_evaluations`, `find_business_process_event_step` and `submit_task_type_business_process_event_step`, after a preview and an explicit yes. Submit sends answers already saved in the Workday task. Never manager or other workers' steps.
- Docs: README Main Logic, TENANT_METADATA, HANDOVER and the MCP `performance-submit-skill` now point to the native submit path. MCP `commit_submission` for self reviews stays gated until mapped through the gateway.


## Unreleased: Required Workday security docs

- Documented required Workday domain grants per App Builder tool in `docs/SECURITY.md`: employees via Self-Service / Employee As Self, managers via Manager (team), no All Employees on Worker Data: Anytime Feedback. Added verification via View User Permissions for Tool. Linked from README, HANDOVER, and AGENTS.md.

## Unreleased: Workday App Builder catalog

- Added the 17 tenant-verified App Builder tool names and WIDs (`src/catalog.ts`) and a mapping that uses them (`examples/workday-app-builder.mapping.json`).
- New secured tools for mining, review/template reads, business-process step status, goal updates and anytime feedback. All writes go through a full preview, explicit confirmation, a single-use token, and idempotency. An unknown outcome is reported as unknown.
- The gateway now gates any capability whose required inputs are not mapped. It supports `fieldMap`, scrubs upstream errors, and tells access-denied apart from empty.
- Live identity takes the tenant from `WORKDAY_TENANT` when upstream omits it and refuses to start on a mismatch.
- Added the repo-local mine, draft and submit skills and the `pnpm mapping:check` script.
- Self-evaluation submit through the MCP gateway was still a gap at catalog cut; App Builder native submit is in `agents/prch-submit-skill` (see Unreleased above).

## 0.2.0 (2026-11-08)
- Live mode through an upstream Workday MCP server (official SDK client, capability mapping, tools/list verification, strict responses, identity from upstream).
- Postgres store and migrations for drafts, evidence, opt-ins, previews, commits (pending, succeeded, failed, unknown) and audit; reconcile tool.
- GitHub evidence adapter using the documented REST API, behind explicit opt-in.
- Renamed to Performance Review Cycle Helper | Workday MCP.

## 0.1.0 (2026-11-08)
- First release, fixture only.

## Unreleased: Workday Agent Gateway alignment
- Added Agent Gateway mode: ASU OAuth 2.1 + PKCE session (`pnpm asu:login`), runtime paginated discovery with drift checks and list_changed refresh, an approved tool policy, and the `workday_*` agent tools. Writes are re-checked for contract drift at commit.
- Fixed capability mappings are off on Agent Gateway endpoints. Production refuses fixture mode, example config, and fixed bearer tokens.
- Corrected the docs: catalog WIDs are tool identifiers; tenant scope is not claimed either way.
- Skill prompts no longer name upstream Workday tools.
