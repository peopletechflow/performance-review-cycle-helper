import { test } from "node:test";
import assert from "node:assert/strict";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectUpstream, type UpstreamTool } from "../src/core/upstream.js";
import { AgentToolRegistry, fingerprint, ToolPolicyFile, type ToolPolicy } from "../src/core/agentready.js";
import { agentReadyTools } from "../src/core/agent-tools.js";
import { callTool } from "../src/core/tool.js";
import { AsuContextMismatch, AsuReauthRequired, AsuTokenProvider, asuEndpoints, authorizeUrl, exchangeCode, type AsuConfig } from "../src/core/asu.js";
import { startLive } from "../src/core/live.js";
import { readMode } from "../src/core/identity.js";
import { CAPS } from "../src/capabilities.js";
import { setup, as } from "./helpers.js";

type World = { tools: UpstreamTool[]; calls: { name: string; args: unknown }[]; pageSize: number };
async function upstream(w: World) {
  const s = new Server({ name: "wd", version: "0" }, { capabilities: { tools: { listChanged: true } } });
  s.setRequestHandler(ListToolsRequestSchema, async (r) => {
    const start = Number(r.params?.cursor ?? 0); const page = w.tools.slice(start, start + w.pageSize);
    return { tools: page as never, nextCursor: start + w.pageSize < w.tools.length ? String(start + w.pageSize) : undefined };
  });
  s.setRequestHandler(CallToolRequestSchema, async (r) => { w.calls.push({ name: r.params.name, args: r.params.arguments }); return { content: [{ type: "text", text: JSON.stringify(r.params.name === "whoAmI" ? { data: { worker: "W-ME" } } : { ok: true }) }] }; });
  const [a, b] = InMemoryTransport.createLinkedPair(); await s.connect(a);
  return { s, up: await connectUpstream({ transport: b }) };
}
const T = (name: string, props: Record<string, unknown>, extra: Partial<UpstreamTool> = {}): UpstreamTool => ({ name, description: `d ${name}`, inputSchema: { type: "object", properties: props, additionalProperties: false }, ...extra });
const tools = () => [
  T("whoAmI", { contextInstanceId: { type: "string" } }),
  ...Array.from({ length: 7 }, (_, i) => T(`filler${i}`, {})),
  T("getMyGoals", { workerId: { type: "string" }, from: { type: "string" } }, { annotations: { readOnlyHint: true } }),
  T("updateMyGoal", { goalId: { type: "string" }, percent: { type: "number" } }),
  T("giveFeedback", { recipientWorker: { type: "string" }, text: { type: "string" } }),
];
function policyFor(ts: UpstreamTool[]): ToolPolicy {
  const f = (n: string) => fingerprint(ts.find((t) => t.name === n)!);
  return ToolPolicyFile.parse({ version: 1, approvedBy: "test", approvedAt: "2026-11-08", tenantAlias: "acme", agentClientId: "cid", tools: [
    { name: "whoAmI", fingerprint: f("whoAmI"), access: "read", subject: { contextInstanceId: "me" }, identity: { workerIdPath: "data.worker" } },
    { name: "getMyGoals", fingerprint: f("getMyGoals"), access: "read", subject: { workerId: "caller" } },
    { name: "updateMyGoal", fingerprint: f("updateMyGoal"), access: "write" },
    { name: "giveFeedback", fingerprint: f("giveFeedback"), access: "write", objectArgs: ["recipientWorker"] },
  ] });
}

test("discovery is paginated, identity uses the approved tool, subject args are bound server-side", async () => {
  const w: World = { tools: tools(), calls: [], pageSize: 3 };
  const { up } = await upstream(w);
  const reg = new AgentToolRegistry(up, policyFor(w.tools));
  assert.equal(await reg.resolveWorkerId(), "W-ME");
  assert.deepEqual(w.calls.at(-1), { name: "whoAmI", args: { contextInstanceId: "me" } });
  assert.ok(reg.statuses().every((s) => s.status === "available"), JSON.stringify(reg.statuses()));
  await reg.read("getMyGoals", { from: "2026-01-01" }, "W-ME");
  assert.deepEqual(w.calls.at(-1)!.args, { from: "2026-01-01", workerId: "W-ME" });
  await assert.rejects(reg.read("getMyGoals", { workerId: "W-OTHER" }, "W-ME"), /set by the server/);
  await assert.rejects(reg.read("filler1", {}, "W-ME"), /not an approved/);
  await assert.rejects(reg.read("getMyGoals", { nope: 1 }, "W-ME"), /Unknown argument/);
  await up.close();
});

test("rename, schema drift and list_changed turn tools off (fail closed)", async () => {
  const w: World = { tools: tools(), calls: [], pageSize: 50 };
  const { s, up } = await upstream(w);
  const reg = new AgentToolRegistry(up, policyFor(w.tools), { ttlMs: 60 * 60_000 });
  await reg.ensureFresh();
  w.tools = w.tools.map((t) => (t.name === "getMyGoals" ? { ...t, name: "listGoalsForMe" } : t.name === "updateMyGoal" ? T("updateMyGoal", { goalId: { type: "string" }, percent: { type: "string" } }) : t));
  await s.sendToolListChanged();
  await new Promise((r) => setTimeout(r, 20));
  await reg.ensureFresh();
  const st = Object.fromEntries(reg.statuses().map((x) => [x.name, x.status]));
  assert.equal(st.getMyGoals, "missing"); assert.equal(st.updateMyGoal, "drifted");
  assert.ok(!reg.statuses().some((x) => x.name === "listGoalsForMe"), "renamed tool is not auto-approved");
  await up.close();
});

test("description rewrites do not count as drift", async () => {
  const w: World = { tools: tools(), calls: [], pageSize: 50 };
  const { up } = await upstream(w);
  const reg = new AgentToolRegistry(up, policyFor(w.tools));
  w.tools = w.tools.map((t) => ({ ...t, description: "rewritten" }));
  await reg.ensureFresh(true);
  assert.equal(reg.statuses().find((x) => x.name === "getMyGoals")!.status, "available");
  await up.close();
});

test("unbound person argument or read approval of a writing tool is refused", async () => {
  const w: World = { tools: [...tools(), T("peek", { employeeId: { type: "string" } }), T("sneaky", {}, { annotations: { readOnlyHint: false } })], calls: [], pageSize: 50 };
  const { up } = await upstream(w);
  const p = policyFor(w.tools);
  p.tools.push({ name: "peek", fingerprint: fingerprint(w.tools.at(-2)!), access: "read", subject: {}, objectArgs: [] }, { name: "sneaky", fingerprint: fingerprint(w.tools.at(-1)!), access: "read", subject: {}, objectArgs: [] },
    { name: "request_payroll_input", fingerprint: "0".repeat(64), access: "write", subject: {}, objectArgs: [] });
  const reg = new AgentToolRegistry(up, p); await reg.ensureFresh();
  const st = Object.fromEntries(reg.statuses().map((x) => [x.name, x]));
  assert.match(st.peek!.reason!, /without a binding/); assert.match(st.sneaky!.reason!, /marks it as writing/); assert.match(st.request_payroll_input!.reason!, /payroll/);
  await up.close();
});

test("write: exact preview, confirm, and a schema change between preview and commit sends nothing", async () => {
  const w: World = { tools: tools(), calls: [], pageSize: 4 };
  const { s, up } = await upstream(w);
  const reg = new AgentToolRegistry(up, policyFor(w.tools));
  const { store } = await setup();
  const c = as("emp_ava");
  const tl = agentReadyTools({ registry: reg, store, perms: { read: "rc.read", draft: "rc.draft", commit: "rc.submit" }, workerId: (x) => x.userId });
  const roles = { employee: ["rc.read", "rc.draft", "rc.submit"] };
  const run = (n: string, a: unknown) => callTool(tl, roles, store, c, n, a);
  const p = await run("workday_preview_write", { tool: "updateMyGoal", args: { goalId: "G1", percent: 50 } });
  assert.ok(p.ok, JSON.stringify(p)); const d = (p as any).data;
  assert.deepEqual(d.exactCall.args, { goalId: "G1", percent: 50 });
  assert.equal((await run("workday_commit_write", { writeId: d.writeId, previewToken: d.previewToken, idempotencyKey: "key-write-0001", confirm: false })).ok, false);
  w.tools = w.tools.map((t) => (t.name === "updateMyGoal" ? T("updateMyGoal", { goalId: { type: "string" }, percent: { type: "number" }, comment: { type: "string" } }) : t));
  await s.sendToolListChanged();
  const before = w.calls.length;
  const r = await run("workday_commit_write", { writeId: d.writeId, previewToken: d.previewToken, idempotencyKey: "key-write-0001", confirm: true });
  assert.equal(r.ok, false); assert.match(JSON.stringify(r), /changed since the preview|drifted|re-approve/);
  assert.equal(w.calls.length, before, "nothing sent");
  await up.close();
});

test("write: unchanged contract commits once; feedback recipient is an approved object arg", async () => {
  const w: World = { tools: tools(), calls: [], pageSize: 50 };
  const { up } = await upstream(w);
  const reg = new AgentToolRegistry(up, policyFor(w.tools));
  const { store } = await setup(); const c = as("emp_ava");
  const tl = agentReadyTools({ registry: reg, store, perms: { read: "rc.read", draft: "rc.draft", commit: "rc.submit" }, workerId: (x) => x.userId });
  const run = (n: string, a: unknown) => callTool(tl, { employee: ["rc.read", "rc.draft", "rc.submit"] }, store, c, n, a);
  const d = (await run("workday_preview_write", { tool: "giveFeedback", args: { recipientWorker: "W-PEER", text: "thanks" } }) as any).data;
  const a = { writeId: d.writeId, previewToken: d.previewToken, idempotencyKey: "key-write-0002", confirm: true };
  assert.equal((await run("workday_commit_write", a) as any).data.status, "succeeded");
  assert.equal((await run("workday_commit_write", a) as any).data.replayed, true);
  assert.equal(w.calls.filter((x) => x.name === "giveFeedback").length, 1);
  await up.close();
});

const CFG: AsuConfig = { gatewayHost: "us.agent.workday.com", tenantAlias: "acme", clientId: "cid", clientSecret: "sec", redirectUri: "https://agent.example.com/cb", production: true };

test("ASU endpoints follow the documented Agent Gateway contract and PKCE is always sent", () => {
  assert.deepEqual(asuEndpoints(CFG), { authorize: "https://us.agent.workday.com/auth/authorize/acme", token: "https://us.agent.workday.com/auth/oauth2/acme/token", mcp: "https://us.agent.workday.com/acme/mcp" });
  const u = new URL(authorizeUrl(CFG, "st", "ch"));
  assert.equal(u.searchParams.get("response_type"), "code"); assert.equal(u.searchParams.get("code_challenge_method"), "S256"); assert.equal(u.searchParams.get("state"), "st");
  assert.throws(() => asuEndpoints({ ...CFG, gatewayHost: "evil.example.com" }), /Agent Gateway host/);
  assert.throws(() => asuEndpoints({ ...CFG, gatewayHost: "127.0.0.1:9" }), /tests only/);
  assert.throws(() => asuEndpoints({ ...CFG, redirectUri: "http://agent.example.com/cb" }), /https/);
});

test("ASU token exchange: documented form fields, string expires_in, redirect refused", async () => {
  let seen: { url: string; body: string; redirect?: string } | undefined;
  const f = (async (url: string, init: RequestInit) => { seen = { url, body: String(init.body), redirect: init.redirect }; return new Response(JSON.stringify({ access_token: "a", token_type: "Bearer", refresh_token: "r", expires_in: "3600" })); }) as unknown as typeof fetch;
  const s = await exchangeCode(CFG, "code1", "ver1", f, () => 0);
  assert.equal(seen!.url, "https://us.agent.workday.com/auth/oauth2/acme/token"); assert.equal(seen!.redirect, "error");
  const b = new URLSearchParams(seen!.body);
  assert.deepEqual([b.get("grant_type"), b.get("code"), b.get("client_id"), b.get("client_secret"), b.get("code_verifier")], ["authorization_code", "code1", "cid", "sec", "ver1"]);
  assert.equal(s.expiresAt, 3600_000);
  const bad = (async () => new Response(JSON.stringify({ access_token: "a", token_type: "mac" }))) as unknown as typeof fetch;
  await assert.rejects(exchangeCode(CFG, "c", "v", bad), AsuReauthRequired);
});

test("ASU session binding: tenant, agent and worker mismatches are refused", () => {
  const base = { gatewayHost: "us.agent.workday.com", tenantAlias: "acme", clientId: "cid", accessToken: "a", expiresAt: Date.now() + 3600_000 };
  assert.throws(() => new AsuTokenProvider(CFG, { ...base, tenantAlias: "other" }), AsuContextMismatch);
  assert.throws(() => new AsuTokenProvider(CFG, { ...base, clientId: "other-agent" }), AsuContextMismatch);
  assert.throws(() => new AsuTokenProvider(CFG, { ...base, gatewayHost: "eu.agent.workday.com" }), AsuContextMismatch);
  const p = new AsuTokenProvider(CFG, { ...base });
  p.bindWorker("W-ME");
  assert.throws(() => p.bindWorker("W-OTHER"), AsuContextMismatch);
  assert.throws(() => p.assertWorker("W-OTHER"), AsuContextMismatch);
  p.assertWorker("W-ME");
});

test("ASU refresh failure ends the session with no fallback", async () => {
  let calls = 0; let cleared = false;
  const f = (async () => { calls++; return new Response("{}", { status: 400 }); }) as unknown as typeof fetch;
  const p = new AsuTokenProvider(CFG, { gatewayHost: "us.agent.workday.com", tenantAlias: "acme", clientId: "cid", accessToken: "old", refreshToken: "r", expiresAt: 1000 }, { fetch: f, now: () => 0, onChange: (s) => { if (!s) cleared = true; } });
  await assert.rejects(p.token(), AsuReauthRequired);
  assert.ok(cleared); assert.equal(calls, 1);
  await assert.rejects(p.token(), /No ASU session/); assert.equal(calls, 1);
  const noRefresh = new AsuTokenProvider(CFG, { gatewayHost: "us.agent.workday.com", tenantAlias: "acme", clientId: "cid", accessToken: "old", expiresAt: 1000 }, { now: () => 0 });
  await assert.rejects(noRefresh.token(), /no refresh token/);
});

test("ASU refresh is single-flight and keeps the worker binding", async () => {
  let calls = 0;
  const f = (async () => { calls++; return new Response(JSON.stringify({ access_token: "new", token_type: "bearer" })); }) as unknown as typeof fetch;
  const p = new AsuTokenProvider(CFG, { gatewayHost: "us.agent.workday.com", tenantAlias: "acme", clientId: "cid", workerId: "W-ME", accessToken: "old", refreshToken: "r", expiresAt: 1000 }, { fetch: f, now: () => 0 });
  assert.deepEqual(await Promise.all([p.token(), p.token()]), ["new", "new"]); assert.equal(calls, 1);
  p.assertWorker("W-ME");
});

test("production refuses fixtures, example config, fixed bearer tokens, and Agent Gateway hosts in direct mode", async () => {
  assert.throws(() => readMode({ MODE: "fixture", NODE_ENV: "production" }), /fixture/);
  await assert.rejects(startLive({ NODE_ENV: "production", ROLE_MAP_PATH: "x", WORKDAY_MCP_URL: "https://mcp.example.com/mcp", WORKDAY_MCP_TOKEN_FILE: "t", WORKDAY_MCP_MAPPING_PATH: "m" }, CAPS), /not an ASU session/);
  await assert.rejects(startLive({ ROLE_MAP_PATH: "x", WORKDAY_MCP_URL: "https://us.agent.workday.com/acme/mcp", WORKDAY_MCP_TOKEN_FILE: "t", WORKDAY_MCP_MAPPING_PATH: "m" }, CAPS), /Agent Gateway mode/);
  await assert.rejects(startLive({ NODE_ENV: "production", ROLE_MAP_PATH: "examples/role-map.example.json", WORKDAY_AGENT_GATEWAY: "us.agent.workday.com", ASU_SESSION_FILE: "s", AGENT_TOOL_POLICY_PATH: "examples/agent-tool-policy.example.json" }, CAPS), /example config/);
});

test("Agent Gateway mode turns off fixed capability mappings", async () => {
  const { Gateway, MappingFile } = await import("../src/core/upstream.js");
  const w: World = { tools: tools(), calls: [], pageSize: 50 };
  const { up } = await upstream(w);
  const g = await Gateway.create(up, MappingFile.parse({ version: 1, capabilities: { identity: { tool: "whoAmI", args: { contextInstanceId: { const: "me" } } } } }), CAPS, { agentReadyEndpoint: true });
  assert.ok(g.capabilities().every((s) => s.status === "gated" && /agent use only/.test(s.reason!)));
  await up.close();
});
