/**
 * Caller identity. Tools never accept a user or tenant id as an argument; the
 * caller comes from the transport session only.
 *
 * Fixture mode: the operator selects one example user per stdio process via
 * FIXTURE_USER (a key in the fixture file). This is a local test harness, not
 * authentication, and is refused when MODE=live.
 * Live mode: the caller is whoever the upstream Workday MCP server says owns the
 * per-user access token (identity capability), and roles come from the operator's
 * role map. There is no default identity and no shared token.
 */
export type Caller = Readonly<{ tenantId: string; userId: string; roles: readonly string[]; denies: readonly string[] }>;

export type Mode = "fixture" | "live";

export class AccessDenied extends Error {
  constructor(message: string) { super(message); this.name = "AccessDenied"; }
}
export class LiveUnsupported extends Error {
  constructor(what: string) {
    super(`${what} is not available in live mode: no validated tenant connector is configured for it. See docs/ARCHITECTURE.md (contract proof).`);
    this.name = "LiveUnsupported";
  }
}

export function readMode(env: NodeJS.ProcessEnv): Mode {
  const m = (env.MODE ?? "fixture").trim();
  if (m !== "fixture" && m !== "live") throw new Error(`MODE must be fixture or live, got '${m}'`);
  if (m === "fixture" && env.NODE_ENV === "production") throw new Error("NODE_ENV=production refuses fixture mode (invented example data).");
  return m;
}

export type FixtureUser = { tenantId: string; roles: string[]; denies?: string[] };

export function resolveCaller(mode: Mode, env: NodeJS.ProcessEnv, users: Record<string, FixtureUser>): Caller {
  if (mode === "live") throw new LiveUnsupported("Fixture identity");
  const id = env.FIXTURE_USER?.trim();
  if (!id) throw new AccessDenied("FIXTURE_USER is required in fixture mode.");
  const u = users[id];
  if (!u) throw new AccessDenied(`Unknown fixture user '${id}'.`);
  return Object.freeze({ tenantId: u.tenantId, userId: id, roles: Object.freeze([...u.roles]), denies: Object.freeze([...(u.denies ?? [])]) });
}

/** Live caller from the upstream-verified identity. Roles must be granted explicitly in the role map. */
export function liveCaller(identity: { tenantId?: string; workerId: string }, roleMap: Record<string, { roles: string[]; denies?: string[] }>): Caller {
  if (!identity.tenantId) throw new AccessDenied("Identity has no tenant. Set WORKDAY_TENANT.");
  const entry = roleMap[`${identity.tenantId}:${identity.workerId}`] ?? roleMap[`${identity.tenantId}:*`];
  if (!entry || entry.roles.length === 0) throw new AccessDenied("No roles granted to this worker in ROLE_MAP_PATH.");
  return Object.freeze({ tenantId: identity.tenantId as string, userId: identity.workerId, roles: Object.freeze([...entry.roles]), denies: Object.freeze([...(entry.denies ?? [])]) });
}

/** Tenant comes from the upstream identity when it reports one, else from operator config. A mismatch refuses startup. */
export function withTenant(id: { tenantId?: string; workerId: string }, configured?: string): { tenantId: string; workerId: string } {
  const t = id.tenantId ?? configured;
  if (!t) throw new AccessDenied("Upstream identity has no tenant id; set WORKDAY_TENANT.");
  if (id.tenantId && configured && id.tenantId !== configured) throw new AccessDenied("Upstream tenant does not match WORKDAY_TENANT.");
  return { tenantId: t, workerId: id.workerId };
}
