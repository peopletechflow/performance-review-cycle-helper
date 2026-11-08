# Tenant metadata in this repository: release decision

`src/catalog.ts` and `examples/workday-app-builder.mapping.json` contain 17 Workday App Builder tool names and WIDs. The tenant owner confirmed them as tenant-verified on 2026-11-08.

- **What they are:** identifiers for tools in one Workday tenant. They are not credentials and do not grant access by themselves.
- **Why it matters for a public release:** they show how one tenant is configured. Workday's terms may also cover App Builder definitions. This repository contains only names and WIDs, not exported tool definitions, schemas, or documentation.
- **Decision needed before the repository is made public:** the owner either keeps them (accepting that they disclose tenant configuration and confirming they may be redistributed), or replaces them in a new commit with a local file such as `mapping.local.json` (gitignored). Past commits would still contain them unless history is rewritten, which is a separate decision.
- These identifiers are not fabricated examples, and nothing here claims they work in any other tenant.
