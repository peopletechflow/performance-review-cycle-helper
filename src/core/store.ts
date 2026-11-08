import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AccessDenied, type Caller } from "./identity.js";
import { digest } from "./preview.js";
import type { Db } from "./db.js";
import { redact } from "./audit.js";

const h = (t: string) => createHash("sha256").update(t).digest("hex");
export type Resource<T = unknown> = { id: string; kind: string; version: number; state: string; content: T; meta: Record<string, unknown> };
export type CommitStatus = "pending" | "succeeded" | "failed" | "unknown";
export type CommitRow = { status: CommitStatus; digest: string; result: unknown; upstream_ref: string | null; resource_id: string };

/**
 * Durable state: resources, single-use previews (hash only), commits (idempotency + outcome),
 * consents and audit. Every query is scoped by the caller's tenant and user.
 */
export class Store {
  constructor(readonly db: Db, private readonly now = () => new Date()) {}

  async createResource<T>(c: Caller, kind: string, content: T, meta: Record<string, unknown> = {}, state = "draft"): Promise<Resource<T>> {
    const id = `${kind.slice(0, 3)}_${randomBytes(12).toString("hex")}`;
    await this.db.query("insert into resources(id,tenant_id,user_id,kind,version,state,content,meta) values ($1,$2,$3,$4,1,$5,$6,$7)", [id, c.tenantId, c.userId, kind, state, JSON.stringify(content), JSON.stringify(meta)]);
    return { id, kind, version: 1, state, content, meta };
  }

  async getResource<T>(c: Caller, id: string, kind: string): Promise<Resource<T>> {
    const r = (await this.db.query<any>("select id,kind,version,state,content,meta from resources where id=$1 and tenant_id=$2 and user_id=$3 and kind=$4", [id, c.tenantId, c.userId, kind])).rows[0];
    if (!r) throw new AccessDenied(`${kind} not found.`);
    return { ...r, version: Number(r.version), content: typeof r.content === "string" ? JSON.parse(r.content) : r.content, meta: typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta };
  }

  async listResources<T>(c: Caller, kind: string): Promise<Resource<T>[]> {
    const rows = (await this.db.query<any>("select id,kind,version,state,content,meta from resources where tenant_id=$1 and user_id=$2 and kind=$3 order by created_at", [c.tenantId, c.userId, kind])).rows;
    return rows.map((r) => ({ ...r, version: Number(r.version), content: typeof r.content === "string" ? JSON.parse(r.content) : r.content, meta: typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta }));
  }

  /** Optimistic update: only succeeds when version and allowed states match. Bumps version when content changes. */
  async updateResource<T>(c: Caller, id: string, kind: string, expectVersion: number, fromStates: string[], patch: { content?: T; state: string; meta?: Record<string, unknown> }): Promise<Resource<T>> {
    const bump = patch.content !== undefined ? 1 : 0;
    const r = await this.db.query<any>(
      `update resources set version=version+$1, state=$2, content=coalesce($3::jsonb, content), meta=meta || coalesce($4::jsonb,'{}'::jsonb), updated_at=now()
       where id=$5 and tenant_id=$6 and user_id=$7 and kind=$8 and version=$9 and state = any($10) returning version`,
      [bump, patch.state, patch.content === undefined ? null : JSON.stringify(patch.content), patch.meta ? JSON.stringify(patch.meta) : null, id, c.tenantId, c.userId, kind, expectVersion, fromStates]);
    if (!r.rows[0]) throw new AccessDenied(`${kind} changed or is not in an editable state. Reload it.`);
    return this.getResource<T>(c, id, kind);
  }

  async issuePreview(c: Caller, kind: string, resourceId: string, version: number, content: unknown, ttlMs = 15 * 60_000) {
    const token = randomBytes(24).toString("base64url"); const d = digest(content); const exp = new Date(this.now().getTime() + ttlMs);
    await this.db.query("insert into previews(token_hash,tenant_id,user_id,kind,resource_id,version,digest,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8)", [h(token), c.tenantId, c.userId, kind, resourceId, version, d, exp.toISOString()]);
    return { previewToken: token, contentDigest: d, expiresAt: exp.toISOString() };
  }

  /** Atomically consumes the token, then checks it is bound to this caller, action, resource, version and content. */
  async consumePreview(c: Caller, token: string, kind: string, resourceId: string, version: number, content: unknown): Promise<string> {
    const r = (await this.db.query<any>("update previews set consumed_at=now() where token_hash=$1 and consumed_at is null returning tenant_id,user_id,kind,resource_id,version,digest,expires_at", [h(token)])).rows[0];
    if (!r) throw new AccessDenied("Invalid or already-used preview token. Run the preview tool again.");
    if (new Date(r.expires_at).getTime() < this.now().getTime()) throw new AccessDenied("Preview expired. Run the preview tool again.");
    if (r.tenant_id !== c.tenantId || r.user_id !== c.userId) throw new AccessDenied("Preview belongs to a different user.");
    if (r.kind !== kind || r.resource_id !== resourceId) throw new AccessDenied("Preview is for a different action or resource.");
    const d = digest(content);
    if (Number(r.version) !== version || !timingSafeEqual(Buffer.from(r.digest), Buffer.from(d))) throw new AccessDenied("Content changed since preview. Review the new preview before confirming.");
    return d;
  }

  async getCommit(c: Caller, tool: string, key: string): Promise<CommitRow | undefined> {
    const r = (await this.db.query<any>("select status,digest,result,upstream_ref,resource_id from commits where tenant_id=$1 and user_id=$2 and tool=$3 and idem_key=$4", [c.tenantId, c.userId, tool, key])).rows[0];
    return r ? { ...r, result: typeof r.result === "string" ? JSON.parse(r.result) : r.result } : undefined;
  }

  /**
   * Durable idempotent write with an explicit outcome:
   * pending (in flight) -> succeeded | failed (upstream said no) | unknown (timeout, transport or invalid response).
   * Only the first claim of a key executes `fn`. Unknown outcomes are never retried blindly; use reconcile.
   */
  async commitOnce<T>(c: Caller, tool: string, key: string, resourceId: string, contentDigest: string, fn: () => Promise<{ result: T; upstreamRef?: string }>, classify: (e: unknown) => "failed" | "unknown"): Promise<{ status: CommitStatus; result: unknown; replayed: boolean }> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new AccessDenied("idempotencyKey must be 8-128 chars [A-Za-z0-9_-].");
    const claimed = (await this.db.query("insert into commits(tenant_id,user_id,tool,idem_key,resource_id,digest,status) values ($1,$2,$3,$4,$5,$6,'pending') on conflict do nothing returning idem_key", [c.tenantId, c.userId, tool, key, resourceId, contentDigest])).rows.length === 1;
    if (!claimed) {
      const prev = (await this.getCommit(c, tool, key))!;
      if (prev.digest !== contentDigest || prev.resource_id !== resourceId) throw new AccessDenied("idempotencyKey was already used for different content.");
      return { status: prev.status, result: prev.result, replayed: true };
    }
    const set = (status: CommitStatus, result: unknown, ref?: string) => this.db.query("update commits set status=$1, result=$2, upstream_ref=$3, updated_at=now() where tenant_id=$4 and user_id=$5 and tool=$6 and idem_key=$7", [status, JSON.stringify(result ?? null), ref ?? null, c.tenantId, c.userId, tool, key]);
    try {
      const { result, upstreamRef } = await fn();
      await set("succeeded", result, upstreamRef);
      return { status: "succeeded", result, replayed: false };
    } catch (e) {
      const status = classify(e); const result = { error: e instanceof Error ? e.message : "error" };
      await set(status, result);
      return { status, result, replayed: false };
    }
  }

  async resolveUnknown(c: Caller, tool: string, key: string, status: "succeeded" | "failed", result: unknown, ref?: string): Promise<void> {
    await this.db.query("update commits set status=$1, result=$2, upstream_ref=$3, updated_at=now() where tenant_id=$4 and user_id=$5 and tool=$6 and idem_key=$7 and status='unknown'", [status, JSON.stringify(result), ref ?? null, c.tenantId, c.userId, tool, key]);
  }

  async setConsent(c: Caller, scope: string, granted: boolean): Promise<void> {
    await this.db.query(`insert into consents(tenant_id,user_id,scope,granted_at,revoked_at) values ($1,$2,$3,now(), case when $4 then null else now() end)
      on conflict (tenant_id,user_id,scope) do update set granted_at = case when $4 then now() else consents.granted_at end, revoked_at = case when $4 then null else now() end`, [c.tenantId, c.userId, scope, granted]);
  }
  async hasConsent(c: Caller, scope: string): Promise<boolean> {
    return (await this.db.query("select 1 from consents where tenant_id=$1 and user_id=$2 and scope=$3 and revoked_at is null", [c.tenantId, c.userId, scope])).rows.length === 1;
  }

  async audit(e: { tool: string; tenantId: string; userId: string; outcome: string; inputs: unknown; detail?: string }): Promise<void> {
    try { await this.db.query("insert into audit_log(tenant_id,user_id,tool,outcome,inputs,detail) values ($1,$2,$3,$4,$5,$6)", [e.tenantId, e.userId, e.tool, e.outcome, JSON.stringify(redact(e.inputs)), e.detail ?? null]); }
    catch { process.stderr.write('{"src":"audit","evt":"db_write_failed"}\n'); }
  }
}
