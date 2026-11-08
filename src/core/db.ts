import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Minimal query surface shared by `pg` (Pool) and PGlite. */
export type Db = { query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> };

/**
 * Apply versioned SQL migrations from db/migrations (NNNN_name.sql) in order. Each file runs once;
 * a checksum guards against editing an applied migration.
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (version int primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
  const applied = new Map((await db.query<{ version: number; checksum: string }>("select version, checksum from schema_migrations")).rows.map((r) => [Number(r.version), r.checksum]));
  const done: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_[a-z0-9_]+\.sql$/.test(x)).sort()) {
    const version = Number(f.slice(0, 4)); const sql = readFileSync(join(dir, f), "utf8");
    const sum = createHash("sha256").update(sql).digest("hex");
    if (applied.has(version)) { if (applied.get(version) !== sum) throw new Error(`Migration ${f} changed after it was applied.`); continue; }
    await db.query("begin");
    try {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      await db.query("insert into schema_migrations(version, name, checksum) values ($1,$2,$3)", [version, f, sum]);
      await db.query("commit");
    } catch (e) { await db.query("rollback"); throw e; }
    done.push(f);
  }
  return done;
}

/** Postgres for live (DATABASE_URL); in-process PGlite for the fixture runner and tests only. */
export async function openDb(opts: { databaseUrl?: string; allowEmbedded: boolean }): Promise<Db & { close(): Promise<void> }> {
  if (opts.databaseUrl) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: opts.databaseUrl, max: 5 });
    return { query: (s, p) => pool.query(s, p as unknown[]) as never, close: () => pool.end() };
  }
  if (!opts.allowEmbedded) throw new Error("DATABASE_URL is required in live mode.");
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite();
  return { query: (s, p) => lite.query(s, p as unknown[]) as never, close: () => lite.close() };
}
