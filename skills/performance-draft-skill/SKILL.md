---
name: performance-draft-skill
description: Draft your self review or requested feedback in your own voice from evidence you collected. Draft only; nothing is sent.
allowed-tools: mcp__performance-review-cycle-helper__get_my_review_cycle, mcp__performance-review-cycle-helper__get_my_open_review, mcp__performance-review-cycle-helper__list_my_feedback_requests, mcp__performance-review-cycle-helper__set_voice_samples, mcp__performance-review-cycle-helper__get_drafting_context, mcp__performance-review-cycle-helper__save_draft, mcp__performance-review-cycle-helper__get_draft, mcp__performance-review-cycle-helper__workday_list_agent_tools, mcp__performance-review-cycle-helper__workday_review_self_read, mcp__performance-review-cycle-helper__workday_goals_self_read, mcp__performance-review-cycle-helper__workday_feedback_self_read
---
# Draft in your voice


1. `get_drafting_context` gives the template, goals, collected evidence, voice samples, and drafting rules. Follow the rules.
2. Write from cited evidence and what the user tells you. Each section cites evidenceIds or the user attests it.
3. Ratings: never propose one. If `get_my_open_review` returns rating scales, show the actual scale and let the user pick in Workday. If no scale is returned, say so.
4. Save with `save_draft`. Show the user the full draft. Drafting never makes a submit tool available that the server reports as gated.

## Workday Agent Gateway mode
When the server runs against the Workday Agent Gateway, the fixed tools above may report "agent use only". Then call `workday_list_agent_tools`. It lists the capabilities this server allows (for example `workday_goals_self_read`) and which live Workday tools an administrator approved for each. Choose from that list using each tool's live description and schema; tool names and schemas change without notice, so never rely on a name you remember. The server fills in person fields from your own identity and only accepts record ids that came back in your own earlier results. Agent Gateway writes are switched off in this release; use the fixed preview and commit tools above when they are available.
