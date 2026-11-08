import { z } from "zod";
import type { Caller } from "./core/identity.js";
import { EVIDENCE, SOURCES } from "./fixtures/data.js";

export type EvidenceItem = { evidenceId: string; sourceId: string; date: string; title: string; text: string; ref: string; author: string };
export interface EvidenceProvider {
  readonly sourceId: string; readonly provider: string; readonly label: string; readonly example: boolean;
  /** Only items authored by the account behind the user's own credential, inside [from, to]. */
  collect(c: Caller, from: string, to: string): Promise<EvidenceItem[]>;
}

/** EXAMPLE DATA: fixture sources, one set per example user. */
export function fixtureProviders(c: Caller): EvidenceProvider[] {
  return (SOURCES[c.userId] ?? []).map((s) => ({
    sourceId: s.sourceId, provider: s.provider, label: s.label, example: true,
    collect: async (cc, from, to) => EVIDENCE.filter((e) => e.tenantId === cc.tenantId && e.authorId === cc.userId && e.sourceId === s.sourceId && e.date >= from && e.date <= to)
      .map((e) => ({ evidenceId: e.evidenceId, sourceId: e.sourceId, date: e.date, title: e.title, text: e.text, ref: e.ref, author: "you" })),
  }));
}

const GhUser = z.object({ login: z.string().min(1).max(100) }).passthrough();
const GhSearch = z.object({ total_count: z.number(), items: z.array(z.object({
  id: z.number(), number: z.number(), title: z.string().max(1000), html_url: z.string().url(), body: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).passthrough(), pull_request: z.object({ merged_at: z.string().nullable().optional() }).passthrough().optional(), closed_at: z.string().nullable().optional(),
}).passthrough()) }).passthrough();

/**
 * Real GitHub evidence source using the documented REST API (GET /user, GET /search/issues) with the
 * user's own read-only token. Returns merged pull requests authored by that GitHub account.
 */
export function githubProvider(opts: { token: string; repoAllowlist?: string[]; fetch?: typeof fetch; apiBase?: string }): EvidenceProvider {
  const f = opts.fetch ?? fetch; const base = opts.apiBase ?? "https://api.github.com";
  const headers = { Authorization: `Bearer ${opts.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "performance-review-cycle-helper" };
  const get = async (path: string) => {
    const r = await f(`${base}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path.split("?")[0]}`);
    return r.json();
  };
  return {
    sourceId: "src_github", provider: "github", label: "GitHub: your merged pull requests", example: false,
    async collect(_c, from, to) {
      const { login } = GhUser.parse(await get("/user"));
      const repos = (opts.repoAllowlist ?? []).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)).map((r) => ` repo:${r}`).join("");
      const q = `author:${login} type:pr is:merged merged:${from}..${to}${repos}`;
      const res = GhSearch.parse(await get(`/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated`));
      return res.items.filter((i) => i.user.login === login).map((i) => ({
        evidenceId: `gh_${i.id}`, sourceId: "src_github", date: (i.pull_request?.merged_at ?? i.closed_at ?? to).slice(0, 10),
        title: i.title, text: (i.body ?? "").slice(0, 1500), ref: i.html_url, author: login,
      })).filter((i) => i.date >= from && i.date <= to);
    },
  };
}
