# Changelog

## Unreleased: Workday App Builder catalog

- Added the 17 tenant-verified App Builder tool names and WIDs (`src/catalog.ts`) and a mapping that uses them (`examples/workday-app-builder.mapping.json`).
- New secured tools for mining, review/template reads, business-process step status, goal updates and anytime feedback. All writes go through a full preview, explicit confirmation, a single-use token, and idempotency. An unknown outcome is reported as unknown.
- The gateway now gates any capability whose required inputs are not mapped. It supports `fieldMap`, scrubs upstream errors, and tells access-denied apart from empty.
- Live identity takes the tenant from `WORKDAY_TENANT` when upstream omits it and refuses to start on a mismatch.
- Added the repo-local mine, draft and submit skills and the `pnpm mapping:check` script.
- Self-evaluation submit is still a gap: the catalog has no action for it.

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
