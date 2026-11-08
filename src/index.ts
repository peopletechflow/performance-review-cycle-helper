#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { liveCaller, readMode, resolveCaller } from "./core/identity.js";
import { buildMcpServer } from "./core/tool.js";
import { migrate, openDb } from "./core/db.js";
import { Store } from "./core/store.js";
import { connectUpstream, Gateway } from "./core/upstream.js";
import { LiveBackend, type Backend } from "./core/backend.js";
import { list, loadMapping, loadRoleMap, readSecretFile } from "./core/config.js";
import { USERS } from "./fixtures/data.js";
import { CAPS } from "./capabilities.js";
import { createFixtureBackend } from "./fixture-backend.js";
import { fixtureProviders, githubProvider, type EvidenceProvider } from "./evidence.js";
import type { Caller } from "./core/identity.js";
import { createReviewHelper } from "./tools.js";

const env = process.env;
const mode = readMode(env);
const db = await openDb({ databaseUrl: env.DATABASE_URL, allowEmbedded: mode === "fixture" });
await migrate(db, fileURLToPath(new URL("../db/migrations", import.meta.url)));
const store = new Store(db);

let backend: Backend; let caller;
if (mode === "live") {
  if (!env.WORKDAY_MCP_URL || !env.WORKDAY_MCP_TOKEN_FILE || !env.WORKDAY_MCP_MAPPING_PATH || !env.ROLE_MAP_PATH) throw new Error("Live mode needs WORKDAY_MCP_URL, WORKDAY_MCP_TOKEN_FILE, WORKDAY_MCP_MAPPING_PATH and ROLE_MAP_PATH.");
  const up = await connectUpstream({ url: env.WORKDAY_MCP_URL, accessToken: readSecretFile(env.WORKDAY_MCP_TOKEN_FILE, "WORKDAY_MCP_TOKEN_FILE") });
  const gw = await Gateway.create(up, loadMapping(env.WORKDAY_MCP_MAPPING_PATH), CAPS, { disabled: list(env.DISABLED_CAPABILITIES) });
  if (!gw.isAvailable("identity")) throw new Error("Live mode needs a verified identity capability mapping; refusing to start.");
  caller = liveCaller(await gw.invoke("identity", {}), loadRoleMap(env.ROLE_MAP_PATH));
  backend = new LiveBackend(gw);
} else {
  caller = resolveCaller(mode, env, USERS);
  backend = createFixtureBackend();
}
const github = env.GITHUB_TOKEN_FILE ? githubProvider({ token: readSecretFile(env.GITHUB_TOKEN_FILE, "GITHUB_TOKEN_FILE"), repoAllowlist: list(env.GITHUB_REPO_ALLOWLIST) }) : undefined;
const providers = (c: Caller): EvidenceProvider[] => [...(mode === "fixture" ? fixtureProviders(c) : []), ...(github ? [github] : [])];
const app = createReviewHelper({ backend, store, providers });
const server = buildMcpServer({ name: "performance-review-cycle-helper", version: "0.2.0", title: "Performance Review Cycle Helper | Workday MCP" }, app.tools, app.roles, store, caller, list(env.DISABLED_TOOLS));
await server.connect(new StdioServerTransport());
process.stderr.write(`performance-review-cycle-helper (Workday MCP): ${mode} mode, evidence sources ${github ? "github" : "none live"}\n`);
