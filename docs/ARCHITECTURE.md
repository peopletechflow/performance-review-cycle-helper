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

## Workday Agent Gateway mode (2026-11-08)
`src/core/asu.ts` handles ASU delegate OAuth: PKCE, the documented authorize and token endpoints, a session bound to gateway, tenant, agent client and worker, and refresh that fails closed. `src/core/agentready.ts` does paginated discovery, list_changed and TTL refresh, contract fingerprints, the approved tool policy, server-side subject binding, and live-schema validation (Ajv). `src/core/agent-tools.ts` exposes one tool per enabled capability ceiling from `src/agent-capabilities.ts`. Writes are disabled by default; when enabled they go preview, confirm, then a fingerprint re-check at commit. See AGENT_GATEWAY_SECURITY.md. `src/core/live.ts` chooses Agent Gateway mode or non-production direct mapping mode. Fixed capability mappings are off on Agent Gateway endpoints.

## Status
| | Implemented and tested | Live verified |
| --- | --- | --- |
| Upstream Workday MCP client, tools/list check, strict schemas, identity | yes, against test-double MCP servers | **no** |
| Durable Postgres state, unknown outcomes, reconcile | yes (PGlite) | **no** |
| GitHub evidence adapter (GET /user, GET /search/issues) | yes, against a test double of the documented API | **no live call made** |
| Fixture mode | yes | n/a |

**Self-review submission:** the code path exists, but no upstream Workday MCP tool for submitting a worker's own self evaluation has been verified for any tenant. Workday's documented Performance_Management web service does not list an operation that completes a worker's own self-evaluation step, so `self_review_submit` stays gated until your upstream server exposes one and it passes the contract check.

## Lifecycle
`cycle -> opt-in -> evidence -> draft -> preview -> confirmed submission -> status (reconcile if unknown)`. Edits make a new version and invalidate the preview. Submitted drafts are locked.

## Capabilities
| Capability | Tools | Fixture | Live |
| --- | --- | --- | --- |
| `identity` (required) | all | example users | mapped upstream tool |
| `review_cycle_read` | `get_my_review_cycle`, due checks | yes | when mapped |
| `goals_read` | `list_my_goals`, drafting context | yes | when mapped |
| `feedback_requests_read` | `list_my_feedback_requests` | yes | when mapped |
| `self_review_submit`, `peer_feedback_submit`, `submission_status` | `commit_submission`, `reconcile_my_submission` | yes | when mapped and verified (see above) |
| Evidence: GitHub | `set_evidence_source_opt_in`, `collect_evidence` | n/a | with `GITHUB_TOKEN_FILE` and opt-in |
| Evidence: chat, docs, mail | | example sources only | not implemented |

"Mines your work automatically" means: only sources you opted in to, only a window you choose inside the review period, only items you authored. Never ratings, rankings, outcome suggestions or sensitive-trait inference; the user is the author and Claude drafts.

## Provenance
`src/core/` adapts security ideas from `peopletechflow/workday-mcp-schema` at `4bf10b27b025a48b0882d98ab65983fdba271159` (MIT, same owner). That repository is unchanged; its time-off support does not imply review-write support.
