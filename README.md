# Performance Review Cycle Helper | Workday MCP

> **Status: experimental.** This is an independent project and is not affiliated with or endorsed by Workday. It has not been run against a production Workday tenant, and live adapters only work for capabilities your tenant mapping verifies (everything else is gated). Fixture data is invented. Security: see [SECURITY.md](SECURITY.md). Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md). CI is a template in `docs/ci-workflow.example.yml` and is not active until it is installed.


An independent, task-shaped **Workday MCP** server plus a Claude skill. Not affiliated with, endorsed by, or certified by Workday, Inc.; Workday is a trademark of Workday, Inc.

Employees run **their own** review cycle in Claude: see the cycle and goals, collect evidence from sources they opted in to, draft a self review or requested feedback in their own voice with citations, preview the exact submission, and submit through their Workday MCP server only after confirming.

## How it connects
```
Claude --stdio MCP--> Performance Review Cycle Helper --MCP (your token)--> your upstream Workday MCP server
                         |-- Postgres: drafts, evidence, opt-ins, previews, commits, audit
                         `-- GitHub REST API (your token, after opt-in)
```

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

## Quick start (fixture mode)
```bash
pnpm install
pnpm check                      # typecheck + 20 tests
FIXTURE_USER=emp_ava pnpm dev
```
Claude Desktop: `pnpm build`, use `examples/claude_desktop_config.json`, load `skills/performance-review-cycle-helper/SKILL.md`.

## Live setup
Same as Internal People Agent: `DATABASE_URL`, `WORKDAY_MCP_URL`, `WORKDAY_MCP_TOKEN_FILE` (your own token, chmod 600), `WORKDAY_MCP_MAPPING_PATH` (from `examples/workday-mcp-mapping.example.json`), `ROLE_MAP_PATH`, then `MODE=live pnpm start`. Optional `GITHUB_TOKEN_FILE` with your own read-only token.

## Docs
[ARCHITECTURE](docs/ARCHITECTURE.md), [SECURITY](docs/SECURITY.md), [HANDOVER](HANDOVER.md), [CHANGELOG](CHANGELOG.md), [AGENTS](AGENTS.md).

## Provenance
`src/core/` adapts security ideas from `peopletechflow/workday-mcp-schema` at `4bf10b27b025a48b0882d98ab65983fdba271159` (MIT, same owner). That repository is unchanged; its time-off support does not imply review-write support.

## CI
Workflow ready in `docs/ci-workflow.example.yml`; enabling it needs the `workflow` permission.

## Workday App Builder catalog (tenant-verified)

The 17 Workday App Builder tool names and WIDs in `src/catalog.ts` were supplied by the tenant owner, who confirmed them as tenant-verified on 2026-11-08. They are catalog tool IDs (the IDs MCP Explorer lists and an ASOR agent definition references), not personal or credential data. In Agent Gateway mode they are reference material only; live discovery and the approved tool policy decide what can be called. `examples/workday-app-builder.mapping.json` maps every capability to those exact tool names. Call `get_workday_catalog` to see each tool, its WID, the secured tool that exposes it, and whether it is mapped.

What is verified, and what is still open:

| Item | Status |
|---|---|
| Tool names and WIDs | Tenant-verified by the tenant owner |
| Input argument names | Not exported. Run `pnpm mapping:check` (read only: tools/list, no tool calls) and add `args` for inputs such as goalId, eventId, reviewId, and the write fields. Until then those capabilities stay gated and say which input is missing. |
| Response shapes | Not exported. Mined reads come back as bounded, quoted data. Identity (`find_staffing_workers`) and `goals_read` need `resultPath`/`fieldMap` taken from a recorded response. |
| Live calls from this repo | Not run yet |
| Self-evaluation submit | **Gap.** The catalog has no action for this step, so `commit_submission` for self reviews stays gated. Nothing generic is used in its place. |
| Peer feedback inside a review | **Gap.** `create_anytime_feedback_events` is anytime feedback, which is a separate object. |
| Reconciling an unknown write | **Gap.** There is no lookup by idempotency key. The user checks Workday. |

Secured tools: `collect_evidence` (Workday sources `wd_<tool>`, opt-in, reports ok/empty/access_denied), `get_my_open_review`, `get_review_period_suggestion`, `get_goal_status`, `get_my_review_step_status`, `preview_/commit_goal_update` (edit_worker_goals, then submit_worker_goal_events if chosen), `preview_/commit_anytime_feedback` (create_anytime_feedback_events; recipient must come from your own feedback request).

Repo-local skills: `skills/performance-mine-skill`, `skills/performance-draft-skill`, `skills/performance-submit-skill`. Their `allowed-tools` list only these secured tools, never the raw upstream write names (a test enforces this).

## Workday Agent Gateway mode (the documented Workday path)

Based on Workday's public docs, read 2026-11-08:
- Agent-Ready MCP Tools: https://developer.workday.com/documentation/GUID-949559e7-10c3-438a-abb2-e452c23d9da8-enHYPHENus/AgentReadyMCPTools
- Connect an External Agent with Workday MCP: https://developer.workday.com/documentation/GUID-03605c39-71d3-4314-bf71-97f274df457c-enHYPHENus/ConnectanExternalAgentwithWorkdayMCP
- Developer Guidelines & Change Policy: https://developer.workday.com/documentation/GUID-04498a6d-10ba-4a41-a917-9fa668641b8d-enHYPHENus/WorkdayAgentReadyMCPToolsDeveloperGuidelinesChangePolicy
- Discover Available Agent-Ready MCP Tools (MCP Explorer, Agent Resource Search): https://developer.workday.com/documentation/GUID-f86470b2-4283-48e6-8d7e-18c91c470878-enHYPHENus
- Configure External Agents / Authenticate Agents to Agent Gateway: https://doc.workday.com/admin-guide/en-us/workday-ai/agents/external-agents/configure-external-agents.html and https://doc.workday.com/admin-guide/en-us/workday-ai/agents/onboard-partner-agent-to-agent-gateway.html

Operator steps in Workday (this repository cannot do them): set up ASOR; register the agent and its skills and tools; configure it (enable skills, choose security groups, set the redirect URI); copy the one-time client ID and secret; activate it, which creates the Agent System User (ASU); and configure security policies for the agent's skills.

Runtime:
1. Run `pnpm asu:login` (with `WORKDAY_AGENT_GATEWAY`, `WORKDAY_TENANT_ALIAS`, `ASU_CLIENT_ID`, `ASU_CLIENT_SECRET_FILE`, `ASU_REDIRECT_URI` and `ASU_SESSION_FILE` set). It walks through the authorization code flow with PKCE: `GET https://{gateway}/auth/authorize/{tenant}`, then `POST https://{gateway}/auth/oauth2/{tenant}/token`. The session file is written atomically with mode 600, and symlinks or loose permissions are refused.
2. Run `pnpm agent-tools:snapshot` (read only). It lists the tools this agent can see, with contract fingerprints. Write `AGENT_TOOL_POLICY_PATH` from it after review; `examples/agent-tool-policy.example.json` shows the format.
3. `MODE=live pnpm start`. The server connects to `https://{gateway}/{tenant}/mcp` with the ASU token and resolves the worker through the policy's identity tool. It then exposes `workday_list_agent_tools` and one tool per enabled capability ceiling (for example `workday_goals_self_read`). There is no generic call tool, and Agent Gateway writes are off by default. See [docs/AGENT_GATEWAY_SECURITY.md](docs/AGENT_GATEWAY_SECURITY.md).

Behaviour:
- Discovery is paginated. The tool list is refreshed on `notifications/tools/list_changed`, after a 5-minute TTL, and always right before a commit.
- A renamed, removed or schema-changed tool turns off until it is re-approved. Description rewrites are not treated as changes.
- If a write tool's contract changes between preview and commit, nothing is sent.
- Person fields at any depth are filled from the authenticated worker. Schemas that cannot be bound safely are refused, and record ids must come from your own earlier results. The manager, HR and payroll denylist is defence in depth only.
- The fixed review tools (`commit_submission` and the others) are off in this mode, because Workday's tools are for agents only and must not be hard-coded.

Access tokens last 60 minutes (documented) and are refreshed before expiry. The refresh request shape is not in the public docs, so it uses the standard OAuth `refresh_token` grant. Any refresh failure ends the session and requires signing in again; nothing falls back to another credential. Revoking access is a Workday-side action (deactivate the agent). Ambient (x509 JWT) agents are not implemented. Not yet run against a live tenant.

Direct mapping mode (`WORKDAY_MCP_URL` + a fixed token file) is for other MCP servers you run yourself, outside production only. A fixed bearer token is not an ASU session.
