# Notes for coding agents

- TypeScript (NodeNext), pnpm. Run `pnpm check` before every commit.
- Tools live in `src/tools.ts`; each declares kind, permission and a strict zod input. Never add user, tenant or employee id inputs.
- Writes must go through `PreviewStore.issue/consume` and `Idempotency.run`. Never add rating, ranking or outcome fields. Submissions require preview and confirm.
- Never mark a domain live in `src/adapters.ts` without the contract proof in docs/ARCHITECTURE.md.
- Fixture data must stay obviously fictional and carry `example: true`.
- No em dashes in docs or user-facing text.
- New Workday data needs a capability in `src/capabilities.ts`, a fixture handler and a test-double contract test. New evidence sources implement `EvidenceProvider`, need opt-in, and return only the user's own items.
- Tenant domain security is operator-owned. Never document or assume All Employees on Worker Data domains for feedback or reviews; see docs/SECURITY.md#required-workday-security.
