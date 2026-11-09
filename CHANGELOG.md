# Changelog

## Unreleased: App Builder native self-evaluation handoff

- Added Workday App Builder native agent package under `agents/`: `performance-review-cycle-helper.agent` plus `prch-submit-skill`, `prch-goals-skill`, `prch-draft-skill`, `prch-mine-skill` and `prch-review-status-skill`.
- `prch-submit-skill` is a UI handoff: reads status via `find_performance_review_self_evaluations` and section read tools (`find_review_questions_sections`, list goal/competency/overall sections), previews saved answers, gets an explicit yes, then deep-links the worker to their own Complete Self Evaluation inbox task so they click Submit in Workday. Never calls submit_task_type, submit_questionnaire, advance or skip. Self scope only.
- README Demo: looping GIF under `docs/media/performance-review-cycle-helper-demo.gif` linked to the Vimeo full demo (`https://vimeo.com/1245191425`).
- Finding (2026-11-09): Workday Developer Agent confirmed none of the 671 agent-ready MCP tools can submit a performance review self-evaluation (Initiation step of the Self Evaluation sub-process; REST `performanceEnablement` selfEvaluations submit has no MCP wrapper). Documented in README Main Logic.
- Docs: README Main Logic, TENANT_METADATA, HANDOVER, AGENTS and the MCP `performance-submit-skill` describe the handoff. MCP `commit_submission` for self reviews stays gated until mapped through the gateway.


## Unreleased: Required Workday security docs

- Documented required Workday domain grants per App Builder tool in `docs/SECURITY.md`: employees via Self-Service / Employee As Self, managers via Manager (team), no All Employees on Worker Data: Anytime Feedback. Added verification via View User Permissions for Tool. Linked from README, HANDOVER, and AGENTS.md.

## Unreleased: Workday App Builder catalog

- Added the 17 tenant-verified App Builder tool names and WIDs (`src/catalog.ts`) and a mapping that uses them (`examples/workday-app-builder.mapping.json`).
- New secured tools for mining, review/template reads, business-process step status, goal updates and anytime feedback. All writes go through a full preview, explicit confirmation, a single-use token, and idempotency. An unknown outcome is reported as unknown.
- The gateway now gates any capability whose required inputs are not mapped. It supports `fieldMap`, scrubs upstream errors, and tells access-denied apart from empty.
- Live identity takes the tenant from `WORKDAY_TENANT` when upstream omits it and refuses to start on a mismatch.
- Added the repo-local mine, draft and submit skills and the `pnpm mapping:check` script.
- Self-evaluation submit through the MCP gateway was still a gap at catalog cut; App Builder native path is the UI handoff in `agents/prch-submit-skill` (see Unreleased above).

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
