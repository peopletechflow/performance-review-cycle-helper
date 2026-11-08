# Workday identifiers in this repository

`src/catalog.ts` and `examples/workday-app-builder.mapping.json` contain 17 Workday tool names and WIDs. The tenant owner confirmed them as tenant-verified on 2026-11-08.

- **What they are:** catalog tool identifiers. Workday's docs describe copying a tool's WID from MCP Explorer or from the ASOR Agent Resource Search API, and passing it as `agent_resource.id` in an agent definition. The docs' own examples publish such WIDs.
- **What they are not:** worker, personal or tenant-account data, or credentials. This repository holds no worker IDs, personal data or tenant hostnames.
- **Tenant scope:** Workday's docs don't say whether these tool WIDs differ between tenants, and nothing here claims either way.
- **Redistribution:** the repository contains only names and IDs, not exported tool definitions, schemas or documentation. It makes no claim about a license to redistribute Workday material beyond that.
- **Runtime use:** reference only. Per Workday's change policy, tool names and schemas change without versioning, so live calls rely on discovery plus the approved tool policy, not on these names.
