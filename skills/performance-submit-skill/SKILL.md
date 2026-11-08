---
name: performance-submit-skill
description: Preview and, after explicit confirmation, submit through the Workday MCP: goal progress updates, anytime feedback, and review drafts where a submit action is mapped.
allowed-tools: mcp__performance-review-cycle-helper__list_integrations, mcp__performance-review-cycle-helper__get_workday_catalog, mcp__performance-review-cycle-helper__get_my_review_step_status, mcp__performance-review-cycle-helper__preview_submission, mcp__performance-review-cycle-helper__commit_submission, mcp__performance-review-cycle-helper__reconcile_my_submission, mcp__performance-review-cycle-helper__preview_goal_update, mcp__performance-review-cycle-helper__commit_goal_update, mcp__performance-review-cycle-helper__preview_anytime_feedback, mcp__performance-review-cycle-helper__commit_anytime_feedback
---
# Preview, confirm, submit

Upstream writes, reached only through the secured commit tools: create_anytime_feedback_events (commit_anytime_feedback), edit_worker_goals and submit_worker_goal_events (commit_goal_update). Status reads: find_business_process_tasks, find_business_process_event, find_remaining_steps_for_business_process_event (get_my_review_step_status).

Self-evaluation: the tenant catalog has no action that submits the self-evaluation step. `commit_submission` for a self review stays gated. Tell the user to submit it in Workday. Do not use any other business-process tool instead.

Every write:
1. Call the preview tool. Show the user the complete exact content returned (never a shortened version).
2. Commit only after the user explicitly confirms that exact preview, with `confirm: true`, the preview token, and one idempotency key you keep.
3. If the status is `unknown` (for example a timeout), say it may have been applied. Do not retry with a new key and do not say it was not sent. Use `reconcile_my_submission` where offered, otherwise ask the user to check Workday.
