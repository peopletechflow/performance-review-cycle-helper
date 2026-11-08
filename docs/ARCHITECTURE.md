# Architecture: Performance Review Cycle Helper | Workday MCP

This is a Workday MCP server (stdio). Setup: README quick start.

```
Claude + skill --stdio--> src/index.ts
  live: Postgres + migrations, upstream Workday MCP connect, identity capability, role map
  fixture: FIXTURE_USER, embedded Postgres, example data
  buildMcpServer() lists only permitted tools
```

Permissions: `rc.read`, `rc.evidence.read`, `rc.draft`, `rc.submit`. Roles: `employee` (all), `readonly` (`rc.read`), `submit_freeze` (`!rc.submit`). Deny wins.

## Layout
```
src/tools.ts         14 task tools and the draft lifecycle
src/capabilities.ts  our contracts per Workday MCP capability
src/evidence.ts      evidence providers: fixture (examples) and GitHub (REST API)
src/core/            upstream MCP gateway, Postgres store, roles, previews, audit (shared design with Internal People Agent)
db/migrations/       versioned SQL
```

## Draft lifecycle
- `save_draft` creates or edits a `draft` resource (new version, state `draft`). Cited `evidenceId`s must be evidence rows the caller collected; uncited self-review sections need `userAttested: true`. No rating or score fields exist.
- `preview_submission` moves to `previewed` and stores a hashed single-use token bound to user, draft, version and payload digest.
- `commit_submission`: replay returns the stored outcome; else the submit capability must be available, the token is consumed atomically, a `commits` row is claimed, and the upstream write runs. Outcomes: succeeded, failed (back to draft), unknown (locked until `reconcile_my_submission`).
- Due dates come from `review_cycle_read`.

## Evidence
Opt-in is a `consents` row per source (`evidence:<sourceId>`), set only by the user. GitHub: `GET /user` for the token's login, then `GET /search/issues?q=author:<login> type:pr is:merged merged:<from>..<to> [repo:...]`; results filtered to that login, validated, stored as `evidence` rows. The GitHub account cannot be cross-checked against the Workday worker; the user supplies their own token.

## Upstream contract
See Internal People Agent ARCHITECTURE: same Gateway (tools/list check, allowlisted argument mapping, strict response parse, isError = failed, transport or contract errors = unknown).

## Workday surfaces researched (official docs)
- Workday Web Services `Performance_Management` (v45.x) lists `Get_Employee_Reviews`, `Get_Employee_Review_Templates`, `Get_Organization_Goals`, `Manage_Goals`, `Start_Performance_Review`, `Import_Employee_Reviews`, `Load_Employee_Reviews`, `Update_Employee_Review_Rating`. Source: community.workday.com production API pages for Performance_Management.
- `Get_Employee_Reviews` is documented as exporting reviews for all workers (older versions say results are unsecured). Using it for a single signed-in worker needs proof of per-user security scoping, otherwise it must not be used.
- `Start_Performance_Review`, `Import_*` and `Load_*` create or load reviews as integrations; they are not the worker completing their own self-evaluation inbox step. `Update_Employee_Review_Rating` is manager ratings and is out of scope.
- The REST API explorer lists Talent Management v2 and Performance Enablement; their review-write coverage has not been verified here.
None of these is called directly. Live access goes through an upstream Workday MCP server whose tools you map; these operations are only background for what such a tool might wrap.

## Contract proof required before enabling live
1. Exact operation and version for: reading the caller's review event and template; submitting the caller's self evaluation; submitting requested feedback.
2. Evidence it runs as the signed-in worker via per-user OAuth, scoped to that worker, with no integration-system user.
3. Recorded non-production request and response, field mapping to `exactSubmission`, business-process step behavior, duplicate detection, error shapes.
4. Per evidence provider: per-user OAuth with read-only scopes, the user's own items only, opt-in per source.
