# Handover: Performance Review Cycle Helper | Workday MCP

**Done (v0.2):** upstream Workday MCP gateway and live identity, Postgres store and migrations, durable opt-ins and evidence, GitHub evidence adapter, draft lifecycle with bound previews, unknown outcomes and reconcile. 20 tests, all with fixture data or test doubles.

**Not verified:** live MCP gateway mapping for `self_review_submit`; the `pg` driver against a real server; a live GitHub call. App Builder native self-evaluation submit has no MCP tool (Developer Agent, 2026-11-09): `agents/prch-submit-skill` is a UI handoff only.

**Next steps:**
1. Map `identity` and `review_cycle_read` for one sandbox tenant and check `list_integrations`.
2. When Workday ships an MCP wrapper for `performanceEnablement` selfEvaluations submit, map MCP gateway `self_review_submit` to it, prove it end to end, then enable `submission_status`. Until then keep the UI handoff in `agents/prch-submit-skill`.
3. Try GitHub evidence with your own read-only token.
4. Add other evidence sources only as real adapters with opt-in.

## Next steps for the App Builder catalog (2026-11-08)
1. Against the tenant, run `WORKDAY_MCP_URL=… WORKDAY_MCP_TOKEN_FILE=… WORKDAY_MCP_MAPPING_PATH=examples/workday-app-builder.mapping.json pnpm mapping:check`.
2. From the printed input schemas, add `args` for wd_goal_status, wd_review_template, wd_bp_event, wd_bp_remaining_steps and the three writes. Record one identity response and set `resultPath`/`fieldMap` for identity and goals_read.
3. MCP `self_review_submit` stays gated until mapped. Native App Builder path is the UI handoff in `agents/prch-submit-skill`.

## Required Workday security (2026-11-09)
Tenant domain grants decide what each App Builder tool can reach. Do not grant `All Employees` (or other company-wide groups) on Worker Data domains for review or anytime feedback. Employees should use Self-Service domains with Employee As Self; managers use the Manager role (team only); HR / Talent roles stay as configured. Full per-tool table, the Anytime Feedback domain change, and the View User Permissions for Tool check: [docs/SECURITY.md](docs/SECURITY.md#required-workday-security).

## Security boundaries (2026-11-08 hardening)
- **Subject arguments.** Any upstream argument that picks a person (worker, employee, user, target, recipient, contextInstanceId, me, wid, ...) must be `{"caller":"workerId"}`, which is filled from the authenticated identity at call time and never from input. Exceptions: `contextInstanceId:"me"` or `me:true` as constants, and inputs a capability lists in `objectInputs`, which its tool resolves server-side (for example the feedback recipient comes from the caller's own feedback request). Anything else is gated at startup. Record IDs (goalId, eventId, reviewId) are not subjects; Workday authorizes them under the caller's own token.
- **Prohibited tools.** Manager, HR and payroll tools (`initiate_change_job`, `approve_business_process_event_step`, `request_payroll_input`, `initiate_performance_review_for_employee`) are refused for every capability, matched case- and punctuation-insensitively. This list does not prove anything about unknown tools. The explicit mapping allowlist plus tools/list contract checks remain the boundary.
- **Response size.** Each upstream HTTP response body (JSON or SSE) is counted while it streams and cancelled after 2 MB, before the SDK parses it. A second 1 MB check runs on the parsed result. There is no limit yet on connection count, idle SSE time, or total memory across concurrent streams, so deployments should also set gateway or proxy connection and stream limits.

## Agent Gateway status (2026-11-08)
Implemented and tested against in-memory MCP servers and mocked token endpoints. Not yet run against a live tenant. The tenant operator must do the ASOR registration, configuration and activation and set the skill security policies. The refresh request shape and revocation are not documented publicly: refresh uses the standard OAuth grant and fails closed. Self-evaluation submit: App Builder native path is the UI handoff in `agents/prch-submit-skill` (no agent-ready submit tool among 671); MCP gateway `self_review_submit` stays gated until mapped. Design: docs/AGENT_GATEWAY_SECURITY.md (capability ceilings, no generic call tool, writes off by default, attested self identity rechecked after refresh). By-id and free-text tools are unavailable until a tenant-verified ownership contract exists; reads require readOnlyHint true.
