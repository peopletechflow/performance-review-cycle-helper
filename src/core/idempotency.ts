import { AccessDenied, type Caller } from "./identity.js";

/**
 * Idempotent commits scoped by tenant + user + tool + key. Concurrent calls with the
 * same key share one in-flight execution; reuse of a key for different content is rejected.
 * In-memory: valid for fixture mode only (live writes are not enabled in this release).
 */
export class Idempotency {
  private readonly done = new Map<string, { digest: string; result: unknown }>();
  private readonly inflight = new Map<string, { digest: string; p: Promise<unknown> }>();

  async run<T>(caller: Caller, tool: string, key: string, contentDigest: string, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new AccessDenied("idempotencyKey must be 8-128 chars [A-Za-z0-9_-].");
    const k = `${caller.tenantId}\u0000${caller.userId}\u0000${tool}\u0000${key}`;
    const prev = this.done.get(k) ?? this.inflight.get(k);
    if (prev) {
      if (prev.digest !== contentDigest) throw new AccessDenied("idempotencyKey was already used for different content.");
      const r = "p" in prev ? await prev.p : prev.result;
      return { result: r as T, replayed: true };
    }
    const p = fn();
    this.inflight.set(k, { digest: contentDigest, p });
    try {
      const result = await p;
      this.done.set(k, { digest: contentDigest, result });
      return { result, replayed: false };
    } finally { this.inflight.delete(k); }
  }

  /** Lookup for the commit path before re-validating a consumed preview. */
  peek(caller: Caller, tool: string, key: string): { digest: string } | undefined {
    const k = `${caller.tenantId}\u0000${caller.userId}\u0000${tool}\u0000${key}`;
    return this.done.get(k) ?? this.inflight.get(k);
  }
}
