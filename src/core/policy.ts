import { AccessDenied, type Caller } from "./identity.js";

/** Role -> permissions. A deny (role-level `!perm` or caller denies) always wins over any grant. */
export type RoleTable = Record<string, readonly string[]>;

export function permissionsFor(caller: Caller, roles: RoleTable): Set<string> {
  const grants = new Set<string>();
  const denies = new Set<string>(caller.denies);
  for (const r of caller.roles) {
    for (const p of roles[r] ?? []) (p.startsWith("!") ? denies : grants).add(p.replace(/^!/, ""));
  }
  for (const d of denies) grants.delete(d);
  return grants;
}

export function requirePermission(caller: Caller, roles: RoleTable, perm: string): void {
  if (!permissionsFor(caller, roles).has(perm)) throw new AccessDenied(`Missing permission '${perm}'.`);
}

/** Ownership check for any stored resource. Cross-tenant and cross-user both deny. */
export function requireOwner(caller: Caller, owner: { tenantId: string; userId: string }): void {
  if (owner.tenantId !== caller.tenantId || owner.userId !== caller.userId) throw new AccessDenied("Resource does not belong to the caller.");
}
