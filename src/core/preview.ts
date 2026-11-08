import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AccessDenied, type Caller } from "./identity.js";

/** Stable JSON (sorted keys) so the digest binds content, not key order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const digest = (v: unknown): string => createHash("sha256").update(canonical(v)).digest("hex");

type Entry = { kind: string; tenantId: string; userId: string; resourceId: string; version: number; digest: string; expiresAt: number };

/**
 * Single-use preview tokens bound to kind + tenant + user + resource + version + content digest.
 * Commit must re-present the current resource; any edit (new version or content) invalidates the token.
 */
export class PreviewStore {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly ttlMs = 15 * 60_000, private readonly now = () => Date.now()) {}

  issue(caller: Caller, kind: string, resourceId: string, version: number, content: unknown): { previewToken: string; contentDigest: string; expiresAt: string } {
    const token = randomBytes(24).toString("base64url");
    const d = digest(content);
    const expiresAt = this.now() + this.ttlMs;
    this.map.set(token, { kind, tenantId: caller.tenantId, userId: caller.userId, resourceId, version, digest: d, expiresAt });
    return { previewToken: token, contentDigest: d, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Validates and consumes. Throws AccessDenied with a specific reason. */
  consume(caller: Caller, token: string, kind: string, resourceId: string, version: number, content: unknown): string {
    const e = this.map.get(token);
    if (!e) throw new AccessDenied("Invalid or already-used preview token. Run the preview tool again.");
    if (e.expiresAt < this.now()) { this.map.delete(token); throw new AccessDenied("Preview expired. Run the preview tool again."); }
    if (e.tenantId !== caller.tenantId || e.userId !== caller.userId) throw new AccessDenied("Preview belongs to a different user.");
    if (e.kind !== kind || e.resourceId !== resourceId) throw new AccessDenied("Preview is for a different action or resource.");
    const d = digest(content);
    if (e.version !== version || !timingSafeEqual(Buffer.from(e.digest), Buffer.from(d))) {
      this.map.delete(token);
      throw new AccessDenied("Content changed since preview. Review the new preview before confirming.");
    }
    this.map.delete(token);
    return d;
  }
}
