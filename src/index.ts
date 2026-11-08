#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readMode, resolveCaller } from "./core/identity.js";
import { buildMcpServer } from "./core/tool.js";
import { Audit } from "./core/audit.js";
import { USERS } from "./fixtures/data.js";
import { createReviewCompanion } from "./tools.js";

const mode = readMode(process.env);
const caller = resolveCaller(mode, process.env, USERS); // live mode fails closed here
const app = createReviewCompanion(mode);
const server = buildMcpServer({ name: "review-companion", version: "0.1.0" }, app.tools, app.roles, new Audit(process.env.AUDIT_LOG_PATH), caller);
await server.connect(new StdioServerTransport());
process.stderr.write(`review-companion: ${mode} mode, caller ${caller.userId}\n`);
