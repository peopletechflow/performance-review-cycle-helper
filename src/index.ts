#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readMode, resolveCaller } from "./core/identity.js";
import { buildMcpServer } from "./core/tool.js";
import { Audit } from "./core/audit.js";
import { USERS } from "./fixtures/data.js";
import { createPerformanceReviewCycleHelper } from "./tools.js";

const mode = readMode(process.env);
const caller = resolveCaller(mode, process.env, USERS); // live mode fails closed here
const app = createPerformanceReviewCycleHelper(mode);
const server = buildMcpServer({ name: "performance-review-cycle-helper", version: "0.1.0", title: "Performance Review Cycle Helper | Workday MCP" }, app.tools, app.roles, new Audit(process.env.AUDIT_LOG_PATH), caller);
await server.connect(new StdioServerTransport());
process.stderr.write(`performance-review-cycle-helper: ${mode} mode, caller ${caller.userId}\n`);
