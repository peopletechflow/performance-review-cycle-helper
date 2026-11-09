# Security: Performance Review Cycle Helper | Workday MCP

- Identity from the upstream Workday MCP `identity` capability for the user's own token; fixture identity refused in live. No identity arguments in any tool.
- Roles from `ROLE_MAP_PATH`, deny wins, kill switches `DISABLED_TOOLS` and `DISABLED_CAPABILITIES`.
- Allowlisted capabilities only, each mapped to one verified upstream tool; strict response schemas.
- Evidence: explicit per-source opt-in stored durably; opt-out stops reads; only items authored by the token's account, inside the review period, at most 366 days. GitHub token is the user's own, read-only, `chmod 600`.
- Confidentiality: drafts owned by their author; peer feedback scoped to the assigned reviewer; nothing reads what others wrote.
- Integrity: citations must match collected evidence; no rating, ranking or outcome fields; drafting rules ban sensitive-trait inference.
- Writes: bound single-use previews, `confirm: true`, idempotency keys, durable outcomes, unknown never auto-retried.
- Untrusted content: evidence and voice samples wrapped `{ untrusted: true }`; tested with injected instructions.
- Audit in Postgres with free text redacted.

## Required Workday security

This repository's code cannot enforce Workday domain security. Operators must configure the tenant so employees reach only their own performance data, and managers only their team's. The table below is the required domain setup for the App Builder tools this project maps (see `src/catalog.ts` and `examples/workday-app-builder.mapping.json`). It reflects a 2026-11-09 sandbox audit that removed a broad grant.

**Warning:** Never grant `All Employees`, `All Users` (except where noted for platform navigation), or other company-wide groups on **Worker Data** domains that hold review or feedback content. A Worker Data grant of `All Employees` on Anytime Feedback lets any employee reach colleagues' feedback through the agent tools, even when Self-Service is also present. Prefer Self-Service domains with `Employee As Self` for the worker's own records, and role-based groups (`Manager`, Management Chain, HR / Talent roles) for team or HR access.

| Upstream tool | Required domain / policy (must satisfy one where OR) | Allowed groups (intended) | Notes |
| --- | --- | --- | --- |
| `find_anytime_feedback_events` | Self-Service: Anytime Feedback **or** Worker Data: Anytime Feedback | Self-Service: `Employee As Self`. Worker Data: `Manager`, Management Chain, HR Admin/Analyst/Auditor/Executive/Partner, Talent Admin/Partner, Implementers | **Do not** put `All Employees` on Worker Data: Anytime Feedback. Employees use Self-Service only. |
| `find_worker_anytime_feedback_received` | same two policies | same as above | same warning |
| `find_learning_transcript` | Self-Service: Learning | Contingent Worker / Employee / Extended Enterprise Learner / Pre-Contingent / Pre-Employee As Self | self only |
| `list_my_goals` | Self-Service: Employee Goals | Contingent Worker / Employee / Pre-Contingent / Pre-Employee As Self | self only |
| `find_goal_status` | BP policy Manage Goals (REST) | Contingent Worker As Self, `Employee As Self`, HR Admin, HR Partner, Implementers (and similar) | self / HR |
| `find_performance_review` | Self-Service: Performance Reviews **or** Worker Data: Performance Reviews | Self-Service: `Employee As Self`. Worker Data: Manager, Management Chain, HR / Talent roles, Implementers | no company-wide employee group |
| `find_worker_performance_review_template` | BP policy Start Performance Review (Graph API v1 / REST) | `Employee As Self`, HR Admin, HR Partner, Implementers, Talent Admin, Talent Partner | self / HR |
| `find_business_process_tasks` | Core Navigation **or** Public Business Processes | Workday's standard `All Users` / `All Accounts` on those platform domains | navigation only; does not expose review or feedback body data. Left as Workday defaults. |
| `find_remaining_steps_for_business_process_event` | Core Navigation **or** Public Business Processes | same | same |

`find_business_process_event` (also in the catalog) follows the same Core Navigation / Public Business Processes pattern when used for step status.

Sandbox change that this section documents (tenant `bzyvydgxsb_extdev`, 2026-11-09): on domain **Worker Data: Anytime Feedback** (View), `All Employees` was removed. View retained Manager, Management Chain, HR / Talent roles, and Implementers. Self-Service: Anytime Feedback was left unchanged with `Employee As Self`. After activation, an employee (Aidan Mitzner) retained access to the anytime-feedback tools only via Self-Service: Anytime Feedback / Employee As Self. No other domains were edited; no security group memberships were changed. Management Chain stayed on the Worker Data policy (team-hierarchy scoped, broader than direct manager).

### Quick verification

1. In Workday, open **View Security for Agent Skill** for the Performance agent skill and confirm each tool's required policies.
2. For a test employee and a test manager, run **View User Permissions for Tool** on `find_anytime_feedback_events` and `find_worker_anytime_feedback_received`.
3. Expect: the employee Yes only through Self-Service: Anytime Feedback / Employee As Self; the manager Yes through Manager (or Management Chain) on Worker Data: Anytime Feedback; neither through `All Employees`.
4. Activate pending security policy changes after any domain edit, then re-run the same checks.
