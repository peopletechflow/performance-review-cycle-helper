/**
 * Live-mode wiring.
 * - Agent Gateway mode (WORKDAY_AGENT_GATEWAY set): the documented Workday path. ASU delegate OAuth (PKCE) session,
 *   MCP at https://{gateway}/{tenant}/mcp, runtime discovery inside an approved tool policy. Fixed capability
 *   mappings are off because Workday's tools are for agents only.
 * - Direct mapping mode (WORKDAY_MCP_URL): for other MCP servers you run yourself, outside production only. It is
 *   refused for Agent Gateway hosts.
 */
import { readFileSync } from "node:fs";
import { readOwnerOnlyJson, writeOwnerOnlyJson } from "./secure-file.js";
import { z } from "zod";
import { liveCaller, withTenant, type Caller } from "./identity.js";
import { connectUpstream, Gateway, type CapabilityDef } from "./upstream.js";
import { LiveBackend, type Backend } from "./backend.js";
import { list, loadMapping, loadRoleMap, readSecretFile } from "./config.js";
import { asuEndpoints, AsuTokenProvider, type AsuConfig, type AsuSession } from "./asu.js";
import { AgentToolRegistry, ToolPolicyFile, type Ceiling } from "./agentready.js";

const Session = z.object({ gatewayHost: z.string(), tenantAlias: z.string(), clientId: z.string(), workerId: z.string().optional(), accessToken: z.string(), refreshToken: z.string().optional(), expiresAt: z.number() }).strict();
export function loadSession(path: string): AsuSession | undefined {
  let raw: unknown;
  try { raw = readOwnerOnlyJson(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
  const p = Session.safeParse(raw); return p.success ? p.data : undefined;
}
export function saveSession(path: string, s: AsuSession | undefined) { writeOwnerOnlyJson(path, s ?? {}); }

export function asuConfigFromEnv(env: NodeJS.ProcessEnv): AsuConfig {
  const need = ["WORKDAY_AGENT_GATEWAY", "WORKDAY_TENANT_ALIAS", "ASU_CLIENT_ID", "ASU_CLIENT_SECRET_FILE", "ASU_REDIRECT_URI"].filter((k) => !env[k]);
  if (need.length) throw new Error(`Agent Gateway mode needs ${need.join(", ")} (values come from registering and configuring the agent in ASOR).`);
  return { gatewayHost: env.WORKDAY_AGENT_GATEWAY!, tenantAlias: env.WORKDAY_TENANT_ALIAS!, clientId: env.ASU_CLIENT_ID!, clientSecret: readSecretFile(env.ASU_CLIENT_SECRET_FILE!, "ASU_CLIENT_SECRET_FILE"), redirectUri: env.ASU_REDIRECT_URI!, production: env.NODE_ENV === "production" };
}

/** Example files ship with the repo; production must use operator-reviewed copies. */
function assertNotExample(env: NodeJS.ProcessEnv, ...paths: (string | undefined)[]) {
  if (env.NODE_ENV !== "production") return;
  for (const p of paths) if (p && /example/i.test(p)) throw new Error(`Production refuses example config: ${p}`);
}

export type Live = { backend: Backend; caller: Caller; registry?: AgentToolRegistry; workerIdFor: (c: Caller) => string };

export async function startLive(env: NodeJS.ProcessEnv, caps: Record<string, CapabilityDef>, ceilings: readonly Ceiling[] = []): Promise<Live> {
  if (!env.ROLE_MAP_PATH) throw new Error("Live mode needs ROLE_MAP_PATH.");
  if (env.WORKDAY_AGENT_GATEWAY) {
    if (!env.ASU_SESSION_FILE || !env.AGENT_TOOL_POLICY_PATH) throw new Error("Agent Gateway mode needs ASU_SESSION_FILE (from `pnpm asu:login`) and AGENT_TOOL_POLICY_PATH.");
    assertNotExample(env, env.ROLE_MAP_PATH, env.AGENT_TOOL_POLICY_PATH);
    const cfg = asuConfigFromEnv(env);
    const policy = ToolPolicyFile.parse(JSON.parse(readFileSync(env.AGENT_TOOL_POLICY_PATH, "utf8")));
    if (policy.tenantAlias !== cfg.tenantAlias || policy.agentClientId !== cfg.clientId) throw new Error("Tool policy was approved for a different tenant or agent registration.");
    const sessionPath = env.ASU_SESSION_FILE;
    let registry: AgentToolRegistry | undefined;
    const provider = new AsuTokenProvider(cfg, loadSession(sessionPath), { onChange: (s) => saveSession(sessionPath, s), onRefreshed: () => { if (registry) registry.identityRecheck = true; } });
    const up = await connectUpstream({ url: asuEndpoints(cfg).mcp, accessToken: provider.token });
    registry = new AgentToolRegistry(up, policy, ceilings, { onIdentityMismatch: () => provider.signOut() });
    const workerId = await registry.resolveWorkerId();
    provider.bindWorker(workerId);
    const caller = liveCaller({ tenantId: cfg.tenantAlias, workerId }, loadRoleMap(env.ROLE_MAP_PATH));
    const gw = await Gateway.create(up, undefined, caps, { agentReadyEndpoint: true });
    return { backend: new LiveBackend(gw), caller, registry, workerIdFor: (c) => { provider.assertWorker(c.userId); return c.userId; } };
  }
  if (!env.WORKDAY_MCP_URL || !env.WORKDAY_MCP_TOKEN_FILE || !env.WORKDAY_MCP_MAPPING_PATH) throw new Error("Live mode needs WORKDAY_AGENT_GATEWAY (Workday) or WORKDAY_MCP_URL + WORKDAY_MCP_TOKEN_FILE + WORKDAY_MCP_MAPPING_PATH (other MCP servers, non-production).");
  if (/\.agent\.workday\.com$/i.test(new URL(env.WORKDAY_MCP_URL).hostname)) throw new Error("Workday Agent Gateway endpoints need Agent Gateway mode (ASU OAuth + tool policy), not a fixed token and mapping.");
  if (env.NODE_ENV === "production") throw new Error("Direct mapping mode with a fixed bearer token is not allowed in production. It is not an ASU session: no refresh and no agent/tenant binding.");
  const up = await connectUpstream({ url: env.WORKDAY_MCP_URL, accessToken: readSecretFile(env.WORKDAY_MCP_TOKEN_FILE, "WORKDAY_MCP_TOKEN_FILE") });
  const gw = await Gateway.create(up, loadMapping(env.WORKDAY_MCP_MAPPING_PATH), caps, { disabled: list(env.DISABLED_CAPABILITIES) });
  if (!gw.isAvailable("identity")) throw new Error("Live mode needs a verified identity capability mapping; refusing to start.");
  const caller = liveCaller(withTenant(await gw.invoke("identity", {}), env.WORKDAY_TENANT), loadRoleMap(env.ROLE_MAP_PATH));
  return { backend: new LiveBackend(gw), caller, workerIdFor: (c) => c.userId };
}
