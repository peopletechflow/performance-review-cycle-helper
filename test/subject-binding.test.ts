import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { byteLimitedFetch, connectUpstream, Gateway, MappingFile, type CapabilityDef } from "../src/core/upstream.js";

const out = z.object({ ok: z.boolean() }).strip();
const DEFS: Record<string, CapabilityDef> = {
  identity: { kind: "read", inputs: [], description: "id", output: z.object({ workerId: z.string() }).strip() },
  policy_search: { kind: "read", inputs: ["query"], description: "p", output: out },
  my_record: { kind: "read", inputs: ["goalId"], description: "r", output: out },
  feedback_create: { kind: "write", inputs: ["recipientWorkerId", "text"], description: "f", output: out, objectInputs: { recipientWorkerId: "approved recipient" } },
  narrow_write: { kind: "write", inputs: ["x"], description: "w", output: out },
};
async function up(seen: Record<string, unknown>[]) {
  const s = new McpServer({ name: "up", version: "0" });
  const any = { contextInstanceId: z.string().optional(), me: z.boolean().optional(), worker_id: z.string().optional(), query: z.string().optional(), goalId: z.string().optional(), recipient: z.string().optional(), text: z.string().optional(), x: z.string().optional() };
  for (const n of ["who", "pol", "rec", "fb", "Initiate_Change_Job", "approve_business_process_event_step", "request_payroll_input", "initiate_performance_review_for_employee"])
    s.tool(n, "", any, async (a) => { seen.push({ tool: n, ...a }); return { content: [{ type: "text", text: JSON.stringify(n === "who" ? { workerId: "W-ME" } : { ok: true }) }] }; });
  const [a, b] = InMemoryTransport.createLinkedPair(); await s.connect(a);
  return connectUpstream({ transport: b });
}
const gw = async (caps: Record<string, unknown>, seen: Record<string, unknown>[] = []) => { const u = await up(seen); return { g: await Gateway.create(u, MappingFile.parse({ version: 1, capabilities: caps }), DEFS), u, seen }; };
const st = (g: Gateway, c: string) => g.capabilities().find((x) => x.capability === c)!;

test("startup: identity contextInstanceId pinned to another worker is gated; 'me' and me:true are allowed", async () => {
  let r = await gw({ identity: { tool: "who", args: { contextInstanceId: { const: "OTHER_WID_123" } } } });
  assert.equal(st(r.g, "identity").status, "gated"); assert.match(st(r.g, "identity").reason!, /contextInstanceId/); await r.u.close();
  r = await gw({ identity: { tool: "who", args: { contextInstanceId: { const: "me" } } } }); assert.equal(st(r.g, "identity").status, "available"); await r.u.close();
  r = await gw({ identity: { tool: "who", args: { me: { const: true } } } }); assert.equal(st(r.g, "identity").status, "available"); await r.u.close();
  r = await gw({ identity: { tool: "who", args: { worker_id: { caller: "workerId" } } } }); assert.equal(st(r.g, "identity").status, "gated"); await r.u.close();
});

test("startup: worker_id fed from caller query is gated; caller binding is allowed", async () => {
  let r = await gw({ policy_search: { tool: "pol", args: { worker_id: { from: "query" }, query: { from: "query" } } } });
  assert.equal(st(r.g, "policy_search").status, "gated"); assert.match(st(r.g, "policy_search").reason!, /caller input 'query'/); await r.u.close();
  r = await gw({ policy_search: { tool: "pol", args: { worker_id: { caller: "workerId" }, query: { from: "query" } } } });
  assert.equal(st(r.g, "policy_search").status, "available"); await r.u.close();
});

test("execution: subject arg is the authenticated worker even when the query names someone else", async () => {
  const r = await gw({ policy_search: { tool: "pol", args: { worker_id: { caller: "workerId" }, query: { from: "query" } } } });
  await r.g.invoke("policy_search", { query: "leave policy", worker_id: "W-OTHER" }, { userId: "W-ME" });
  assert.deepEqual(r.seen.at(-1), { tool: "pol", worker_id: "W-ME", query: "leave policy" });
  await assert.rejects(r.g.invoke("policy_search", { query: "x" }), /authenticated caller/);
  await r.u.close();
});

test("record ids are not subjects; approved object inputs (feedback recipient) stay usable", async () => {
  const r = await gw({ my_record: { tool: "rec", args: { goalId: { from: "goalId" } } }, feedback_create: { tool: "fb", args: { recipient: { from: "recipientWorkerId" }, text: { from: "text" } } } });
  assert.equal(st(r.g, "my_record").status, "available"); assert.equal(st(r.g, "feedback_create").status, "available");
  await r.g.invoke("feedback_create", { recipientWorkerId: "W-PEER", text: "t" }, { userId: "W-ME" });
  assert.equal(r.seen.at(-1)!.recipient, "W-PEER"); await r.u.close();
  const bad = await gw({ feedback_create: { tool: "fb", args: { recipient: { from: "text" }, text: { from: "text" } } } });
  assert.equal(st(bad.g, "feedback_create").status, "gated"); await bad.u.close();
});

test("manager/HR/payroll tools are refused for any capability, case- and punctuation-insensitive", async () => {
  for (const t of ["Initiate_Change_Job", "approve_business_process_event_step", "request_payroll_input", "initiate_performance_review_for_employee"]) {
    const r = await gw({ narrow_write: { tool: t, args: { x: { from: "x" } } } });
    assert.equal(st(r.g, "narrow_write").status, "gated", t); assert.match(st(r.g, "narrow_write").reason!, /manager\/HR\/payroll/); await r.u.close();
  }
});

test("byte limit is enforced while streaming, before the SDK reads the body, and cancels the source", async () => {
  let cancelled = false; let sent = 0;
  const src = new ReadableStream<Uint8Array>({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  const f = byteLimitedFetch(200_000, (async () => new Response(src, { headers: { "content-type": "text/event-stream" } })) as typeof fetch);
  const res = await f("https://x.invalid");
  await assert.rejects(res.text(), /exceeded/);
  assert.ok(cancelled); assert.ok(sent < 400_000);
  const g = byteLimitedFetch(10, (async () => new Response("x".repeat(100), { headers: { "content-length": "100" } })) as typeof fetch);
  await assert.rejects(g("https://x.invalid"), /declared/);
  const ok = byteLimitedFetch(1000, (async () => new Response("{\"a\":1}")) as typeof fetch);
  assert.equal(await (await ok("https://x.invalid")).text(), "{\"a\":1}");
});
