#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readMode, resolveCaller } from "./core/identity.js";
import { startLive, type Live } from "./core/live.js";
import { agentReadyTools } from "./core/agent-tools.js";
import { AGENT_CEILINGS } from "./agent-capabilities.js";
import { buildMcpServer } from "./core/tool.js";
import { migrate, openDb } from "./core/db.js";
import { Store } from "./core/store.js";
import type { Backend } from "./core/backend.js";
import { list, readSecretFile } from "./core/config.js";
import { USERS } from "./fixtures/data.js";
import { CAPS } from "./capabilities.js";
import { createFixtureBackend } from "./fixture-backend.js";
import { fixtureProviders, workdayProviders, githubProvider, type EvidenceProvider } from "./evidence.js";
import type { Caller } from "./core/identity.js";
import { createReviewHelper } from "./tools.js";

const env = process.env;
const mode = readMode(env);
const db = await openDb({ databaseUrl: env.DATABASE_URL, allowEmbedded: mode === "fixture" });
await migrate(db, fileURLToPath(new URL("../db/migrations", import.meta.url)));
const store = new Store(db);

let backend: Backend; let caller; let live: Live | undefined;
if (mode === "live") {
  live = await startLive(env, CAPS, AGENT_CEILINGS);
  backend = live.backend; caller = live.caller;
} else {
  caller = resolveCaller(mode, env, USERS);
  backend = createFixtureBackend();
}
const github = env.GITHUB_TOKEN_FILE ? githubProvider({ token: readSecretFile(env.GITHUB_TOKEN_FILE, "GITHUB_TOKEN_FILE"), repoAllowlist: list(env.GITHUB_REPO_ALLOWLIST) }) : undefined;
const providers = (c: Caller): EvidenceProvider[] => [...(mode === "fixture" ? fixtureProviders(c) : []), ...workdayProviders(backend), ...(github ? [github] : [])];
const app = createReviewHelper({ backend, store, providers });
if (live?.registry) app.tools.push(...agentReadyTools({ registry: live.registry, store, ceilings: AGENT_CEILINGS, listPermission: "rc.read", workerId: live.workerIdFor }));
const server = buildMcpServer({ name: "performance-review-cycle-helper", version: "0.2.0", title: "Performance Review Cycle Helper | Workday MCP" }, app.tools, app.roles, store, caller, list(env.DISABLED_TOOLS));
await server.connect(new StdioServerTransport());
process.stderr.write(`performance-review-cycle-helper (Workday MCP): ${mode} mode, evidence sources ${github ? "github" : "none live"}\n`);
