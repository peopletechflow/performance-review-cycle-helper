/**
 * Caller identity. Tools never accept a user or tenant id as an argument; the
 * caller comes from the transport session only.
 *
 * Fixture mode: the operator selects one example user per stdio process via
 * FIXTURE_USER (a key in the fixture file). This is a local test harness, not
 * authentication, and is refused when MODE=live.
 * Live mode: requires a verified per-user Workday OAuth session. Not
 * implemented in this release, so live startup fails closed.
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
  return m;
}

export type FixtureUser = { tenantId: string; roles: string[]; denies?: string[] };

export function resolveCaller(mode: Mode, env: NodeJS.ProcessEnv, users: Record<string, FixtureUser>): Caller {
  if (mode === "live") throw new LiveUnsupported("Per-user session sign-in");
  const id = env.FIXTURE_USER?.trim();
  if (!id) throw new AccessDenied("FIXTURE_USER is required in fixture mode.");
  const u = users[id];
  if (!u) throw new AccessDenied(`Unknown fixture user '${id}'.`);
  return Object.freeze({ tenantId: u.tenantId, userId: id, roles: Object.freeze([...u.roles]), denies: Object.freeze([...(u.denies ?? [])]) });
}
