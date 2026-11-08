import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio server starts in fixture mode and answers a tool call", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts"], env: { PATH: process.env.PATH ?? "", MODE: "fixture", FIXTURE_USER: "emp_ava" }, stderr: "ignore" });
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("get_my_review_cycle"));
  const r = await client.callTool({ name: "get_my_review_cycle", arguments: {} });
  assert.ok(!r.isError);
  await client.close();
});

test("stdio server refuses to start in live mode", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { PATH: process.env.PATH ?? "", MODE: "live" }, encoding: "utf8", timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not available in live mode/);
});
