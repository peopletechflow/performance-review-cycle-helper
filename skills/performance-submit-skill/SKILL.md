---
name: performance-submit-skill
description: Preview and, after explicit confirmation, submit through the Workday MCP: goal progress updates, anytime feedback, and review drafts where a submit action is mapped.
allowed-tools: mcp__performance-review-cycle-helper__list_integrations, mcp__performance-review-cycle-helper__get_workday_catalog, mcp__performance-review-cycle-helper__get_my_review_step_status, mcp__performance-review-cycle-helper__preview_submission, mcp__performance-review-cycle-helper__commit_submission, mcp__performance-review-cycle-helper__reconcile_my_submission, mcp__performance-review-cycle-helper__preview_goal_update, mcp__performance-review-cycle-helper__commit_goal_update, mcp__performance-review-cycle-helper__preview_anytime_feedback, mcp__performance-review-cycle-helper__commit_anytime_feedback, mcp__performance-review-cycle-helper__workday_list_agent_tools, mcp__performance-review-cycle-helper__workday_bp_self_read
---
# Preview, confirm, submit


Self-evaluation: no approved tool submits the self-evaluation step. `commit_submission` for a self review stays gated. Tell the user to submit it in Workday. Do not use any other business-process or manager tool instead.

Every write:
1. Call the preview tool. Show the user the complete exact content returned (never a shortened version).
2. Commit only after the user explicitly confirms that exact preview, with `confirm: true`, the preview token, and one idempotency key you keep.
3. If the status is `unknown` (for example a timeout), say it may have been applied. Do not retry with a new key and do not say it was not sent. Use `reconcile_my_submission` where offered, otherwise ask the user to check Workday.

## Workday Agent Gateway mode
When the server runs against the Workday Agent Gateway, the fixed tools above may report "agent use only". Then call `workday_list_agent_tools`. It lists the capabilities this server allows (for example `workday_goals_self_read`) and which live Workday tools an administrator approved for each. Choose from that list using each tool's live description and schema; tool names and schemas change without notice, so never rely on a name you remember. The server fills in person fields from your own identity and does not accept record ids or free-form text, so tools that need them show as unavailable. Agent Gateway writes are switched off in this release; use the fixed preview and commit tools above when they are available.
