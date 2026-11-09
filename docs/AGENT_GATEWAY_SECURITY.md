# Agent Gateway security design

Workday's Agent-Ready tools are for agents only. Their names and schemas change without notice, and prompts must not bind to tool names. This server therefore never lets the model call an arbitrary Workday tool. Workday security groups (ASOR) limit what the agent system user can reach. They do not stop an agent with broad grants from reaching into another person's data, so this code adds its own limits on top. Domain grants for the App Builder tools (Self-Service vs Worker Data, and the ban on All Employees for feedback Worker Data) are documented in [SECURITY.md](SECURITY.md#required-workday-security).

## Layers, from outermost to innermost
1. **Capability ceilings in code** (`src/agent-capabilities.ts`). Each capability, such as `goals.self.read`, states its access (read or write), the project role permission it needs, and its consent scope. It also says whether it is enabled at all. One MCP tool is generated per enabled ceiling (`workday_goals_self_read`, or a `_preview`/`_commit` pair for a write). These tools run through the normal role, deny and consent checks. There is no tool that calls any tool.
2. **Operator policy** (`AGENT_TOOL_POLICY_PATH`, version 2). The policy binds each live Workday tool, by name and contract fingerprint, to exactly one ceiling and declares where person fields go. It can only narrow access: a capability missing from the code, or disabled there, is refused. Tool names live only here, in security configuration reconciled against live discovery, and never in prompts or skills.
3. **Fail-closed schema analysis.** Schemas are walked recursively through `properties`, `items`, `anyOf/oneOf/allOf` and local `$ref` aliases. The schema is refused for any of these:
   - external, recursive or unresolved refs, or tuples;
   - `not`, `if`, `dependentSchemas`, `unevaluatedProperties` or `patternProperties`;
   - open `additionalProperties`, or objects without declared properties;
   - any person field inside an array or union.
   
   Every person field at any depth must be bound to the caller (`caller`, or `me`/`true` for self selectors). Otherwise the tool is unavailable.
4. **No record-id inputs, no free text.**
   - Workday does not document which output fields are records the signed-in worker owns. A self read can return a manager's or colleague's id (for example `manager.id`), so ownership cannot be inferred from results. No ownership is assumed, and the operator policy cannot declare it either.
   - A tool whose schema takes an id-like field is unavailable. Fields count as id-like by name (`*Id`, `*Wid`, `*Ref`, `*Reference`, `*Key`, `*Descriptor`, and so on) for any scalar type, including numbers. Free-form strings make a tool unavailable too, because they could carry another person's id.
   - Model-supplied values are limited to enums, consts, dates and date-times (the format is checked by this code, not left to Ajv), and non-id numbers or booleans. Unknown fields, nested person fields and unexpected arrays are rejected at any depth. The server then sets the bound fields and validates against the live schema.
   - By-id capabilities stay unavailable until a real, tenant-verified contract says which output path is the caller's own record for which capability. That would be a code change to the ceilings, with tests, not an operator setting.
5. **Writes are off by default.** Write ceilings ship `enabled: false` until a scoped adapter is validated against a tenant. A read capability needs the live tool annotated `readOnlyHint: true` and not `destructiveHint: true`; missing or empty annotations make it unavailable. A destructive tool is never mapped to a write without `allowDestructive` on that exact ceiling. When writes are enabled they keep the existing safety steps:
   - an exact preview, a fingerprint and explicit confirmation;
   - a fingerprint re-check right before commit, so contract drift sends nothing;
   - commit-once with idempotency keys and durable unknown outcomes.
6. **Defence in depth.** A normalized denylist of known manager, HR and payroll tools, plus a name pattern for business-process decisions (approve, deny, send back, advance, rescind, cancel, reassign and so on) and HR changes (initiate change job, termination, hire, compensation, payroll). These are backups. The capability ceilings and annotations are the real gates.
7. **Policy file hygiene.** Duplicate tool names (compared case- and punctuation-insensitively) are rejected when the policy loads.

## Identity
- Exactly one policy entry may use `identity.self`. Its only inputs must be self selectors (`me`/`true`), it must carry `attestedBy`/`attestedAt`, and its `workerIdPath` must select exactly one record (`data[].id` means "the array must have exactly one element"). Numeric indexes such as `data.0.id` are rejected. Search results are never used.
- **Tenant verification:** a tenant administrator calls the tool as two different test workers and confirms each sees only their own single record. They then record their name and the date in the policy.
- After every token refresh the identity is read again. A different worker signs the session out with no fallback.

## Session file
`ASU_SESSION_FILE` is written to a random temp file in the same directory, opened with `wx` and mode 600, fsynced, then renamed atomically; the temp file is removed on failure. Symlinks, non-files, files owned by another user and group- or world-readable files are refused when reading and writing.

## What is not proven
Nothing has been run against a live tenant. Refresh uses the standard OAuth grant, because Workday does not document it. Writes are disabled. Capabilities with no verified tool simply show as unavailable.

## Running in Agent Gateway mode

Based on Workday's public docs, read 2026-11-08:
- Agent-Ready MCP Tools: https://developer.workday.com/documentation/GUID-949559e7-10c3-438a-abb2-e452c23d9da8-enHYPHENus/AgentReadyMCPTools
- Connect an External Agent with Workday MCP: https://developer.workday.com/documentation/GUID-03605c39-71d3-4314-bf71-97f274df457c-enHYPHENus/ConnectanExternalAgentwithWorkdayMCP
- Developer Guidelines & Change Policy: https://developer.workday.com/documentation/GUID-04498a6d-10ba-4a41-a917-9fa668641b8d-enHYPHENus/WorkdayAgentReadyMCPToolsDeveloperGuidelinesChangePolicy
- Discover Available Agent-Ready MCP Tools (MCP Explorer, Agent Resource Search): https://developer.workday.com/documentation/GUID-f86470b2-4283-48e6-8d7e-18c91c470878-enHYPHENus
- Configure External Agents / Authenticate Agents to Agent Gateway: https://doc.workday.com/admin-guide/en-us/workday-ai/agents/external-agents/configure-external-agents.html and https://doc.workday.com/admin-guide/en-us/workday-ai/agents/onboard-partner-agent-to-agent-gateway.html

Operator steps in Workday (this repository cannot do them): set up ASOR; register the agent and its skills and tools; configure it (enable skills, choose security groups, set the redirect URI); copy the one-time client ID and secret; activate it, which creates the Agent System User (ASU); and configure security policies for the agent's skills.

Runtime:
1. Run `pnpm asu:login` (with `WORKDAY_AGENT_GATEWAY`, `WORKDAY_TENANT_ALIAS`, `ASU_CLIENT_ID`, `ASU_CLIENT_SECRET_FILE`, `ASU_REDIRECT_URI` and `ASU_SESSION_FILE` set). It walks through the authorization code flow with PKCE: `GET https://{gateway}/auth/authorize/{tenant}`, then `POST https://{gateway}/auth/oauth2/{tenant}/token`. The session file is written atomically with mode 600, and symlinks or loose permissions are refused.
2. Run `pnpm agent-tools:snapshot` (read only). It lists the tools this agent can see, with contract fingerprints. Write `AGENT_TOOL_POLICY_PATH` from it after review; `examples/agent-tool-policy.example.json` shows the format.
3. `MODE=live pnpm start`. The server connects to `https://{gateway}/{tenant}/mcp` with the ASU token and resolves the worker through the policy's identity tool. It then exposes `workday_list_agent_tools` and one tool per enabled capability ceiling (for example `workday_goals_self_read`). There is no generic call tool, and Agent Gateway writes are off by default. See [Layers](#layers-from-outermost-to-innermost).

Behaviour:
- Discovery is paginated. The tool list is refreshed on `notifications/tools/list_changed`, after a 5-minute TTL, and always right before a commit.
- A renamed, removed or schema-changed tool turns off until it is re-approved. Description rewrites are not treated as changes.
- If a write tool's contract changes between preview and commit, nothing is sent.
- Person fields at any depth are filled from the authenticated worker. Schemas that cannot be bound safely are refused, and tools that take record ids or free-form text are unavailable, because ownership of ids cannot be proven from Workday's contract. Reads need the tool annotated read-only. The manager, HR and payroll denylist is defence in depth only.
- The fixed review tools (`commit_submission` and the others) are off in this mode, because Workday's tools are for agents only and must not be hard-coded.

Access tokens last 60 minutes (documented) and are refreshed before expiry. The refresh request shape is not in the public docs, so it uses the standard OAuth `refresh_token` grant. Any refresh failure ends the session and requires signing in again; nothing falls back to another credential. Revoking access is a Workday-side action (deactivate the agent). Ambient (x509 JWT) agents are not implemented. Not yet run against a live tenant.

Direct mapping mode (`WORKDAY_MCP_URL` + a fixed token file) is for other MCP servers you run yourself, outside production only. A fixed bearer token is not an ASU session.
