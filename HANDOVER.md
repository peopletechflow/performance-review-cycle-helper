# Handover: Performance Review Cycle Helper | Workday MCP

**Done (v0.2):** upstream Workday MCP gateway and live identity, Postgres store and migrations, durable opt-ins and evidence, GitHub evidence adapter, draft lifecycle with bound previews, unknown outcomes and reconcile. 20 tests, all with fixture data or test doubles.

**Not verified:** any tenant upstream tool; a real self-evaluation submit tool; the `pg` driver against a real server; a live GitHub call.

**Next steps:**
1. Map `identity` and `review_cycle_read` for one sandbox tenant and check `list_integrations`.
2. Find or build an upstream Workday MCP tool that completes the worker's own self-evaluation step through the business process; prove it, then map `self_review_submit` and `submission_status`.
3. Try GitHub evidence with your own read-only token.
4. Add other evidence sources only as real adapters with opt-in.
