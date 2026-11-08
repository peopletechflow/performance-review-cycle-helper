# Architecture: Performance Review Cycle Helper | Workday MCP

This is a Workday MCP server (stdio). Setup: README quick start.

```
Claude + skills/performance-review-cycle-helper --stdio--> src/index.ts
  resolveCaller()  session identity (fixture: FIXTURE_USER; live: not implemented -> exit)
  buildMcpServer() lists only permitted tools
src/tools.ts       12 tools, lifecycle state machine
src/core/          identity, policy, preview, idempotency, audit, untrusted text
src/adapters.ts    mode table
```

Permissions: `rc.read`, `rc.evidence.read`, `rc.draft`, `rc.submit`. Roles: `employee` (all), `readonly` (`rc.read`), `submit_freeze` (`!rc.submit`). Deny wins.

## Draft state machine
- `save_draft` creates version 1 or increments the version and resets state to `draft`. Every cited `evidenceId` must be one the caller collected; self-review sections without evidence need `userAttested: true`. No rating or score fields exist.
- `preview_submission` moves to `previewed` and issues a single-use token bound to tenant, user, draft id, version and SHA-256 of the exact submission payload.
- `commit_submission` requires `confirm: true`, the token, and an idempotency key. It checks the current version and digest, then submits once. Concurrent duplicates share one execution.
- Step due dates from the cycle block drafting and preview after they pass.

## State
In-memory, fixture only. No migration because no live write path exists. A live release needs a durable store (previews, drafts, idempotency, audit) with versioned migrations before enabling submission.

## Workday surfaces researched (official docs)
- Workday Web Services `Performance_Management` (v45.x) lists `Get_Employee_Reviews`, `Get_Employee_Review_Templates`, `Get_Organization_Goals`, `Manage_Goals`, `Start_Performance_Review`, `Import_Employee_Reviews`, `Load_Employee_Reviews`, `Update_Employee_Review_Rating`. Source: community.workday.com production API pages for Performance_Management.
- `Get_Employee_Reviews` is documented as exporting reviews for all workers (older versions say results are unsecured). Using it for a single signed-in worker needs proof of per-user security scoping, otherwise it must not be used.
- `Start_Performance_Review`, `Import_*` and `Load_*` create or load reviews as integrations; they are not the worker completing their own self-evaluation inbox step. `Update_Employee_Review_Rating` is manager ratings and is out of scope.
- The REST API explorer lists Talent Management v2 and Performance Enablement; their review-write coverage has not been verified here.
No operation in this repo is mapped to any of these. They are candidates only.

## Contract proof required before enabling live
1. Exact operation and version for: reading the caller's review event and template; submitting the caller's self evaluation; submitting requested feedback.
2. Evidence it runs as the signed-in worker via per-user OAuth, scoped to that worker, with no integration-system user.
3. Recorded non-production request and response, field mapping to `exactSubmission`, business-process step behavior, duplicate detection, error shapes.
4. Per evidence provider: per-user OAuth with read-only scopes, the user's own items only, opt-in per source.
