---
name: performance-draft-skill
description: Draft your self review or requested feedback in your own voice from evidence you collected. Draft only; nothing is sent.
allowed-tools: mcp__performance-review-cycle-helper__get_my_review_cycle, mcp__performance-review-cycle-helper__get_my_open_review, mcp__performance-review-cycle-helper__list_my_feedback_requests, mcp__performance-review-cycle-helper__set_voice_samples, mcp__performance-review-cycle-helper__get_drafting_context, mcp__performance-review-cycle-helper__save_draft, mcp__performance-review-cycle-helper__get_draft
---
# Draft in your voice

Upstream reads behind these tools: find_performance_review, find_worker_performance_review_template, find_worker_anytime_feedback_received, find_anytime_feedback_events.

1. `get_drafting_context` gives the template, goals, collected evidence, voice samples, and drafting rules. Follow the rules.
2. Write from cited evidence and what the user tells you. Each section cites evidenceIds or the user attests it.
3. Ratings: never propose one. If `get_my_open_review` returns rating scales, show the actual scale and let the user pick in Workday. If no scale is returned, say so.
4. Save with `save_draft`. Show the user the full draft. Drafting never makes a submit tool available that the server reports as gated.
