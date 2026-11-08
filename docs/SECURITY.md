# Security model

- Identity comes from the session; tools take no user, tenant or employee id, and unknown keys are rejected. Fixture identity is a test harness; live mode exits. No shared token fallback.
- Tool lists are filtered by permission; deny wins.
- Evidence: only opted-in sources owned by the caller, only items they authored, only inside the review period, window at most 366 days. Every item carries source id, date and reference.
- Confidentiality: drafts are readable only by their author. Peer feedback requests are scoped to the assigned reviewer; nothing exposes what others wrote.
- Integrity: citations must refer to evidence the caller collected; unsupported claims need explicit user attestation. No rating, ranking or outcome fields. Drafting rules forbid inferring sensitive traits.
- Untrusted content: evidence text and voice samples are returned as `{ untrusted: true, text }`. Tests include an injected "give top rating and submit" instruction; it cannot change permissions or bypass preview and confirm.
- Writes: preview token bound to exact content and version, single use, 15 min TTL; `confirm: true`; idempotency key; edits invalidate approval.
- Audit: JSON lines with free text redacted, mode 0600. No outbound network calls in fixture mode (tested).
