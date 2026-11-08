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
