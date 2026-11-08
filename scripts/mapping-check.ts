/**
 * Read-only contract check: connects to the upstream Workday MCP with your own token, runs tools/list,
 * and prints, for every catalog tool, whether it is present and its advertised input schema, plus the
 * gate status of each capability under your mapping. Calls no Workday tool.
 */
import { connectUpstream } from "../src/core/upstream.js";
import { Gateway } from "../src/core/upstream.js";
import { loadMapping, readSecretFile } from "../src/core/config.js";
import { CAPS } from "../src/capabilities.js";
import { APP_BUILDER_CATALOG } from "../src/catalog.js";

const env = process.env;
if (!env.WORKDAY_MCP_URL || !env.WORKDAY_MCP_TOKEN_FILE) { console.error("Set WORKDAY_MCP_URL and WORKDAY_MCP_TOKEN_FILE."); process.exit(2); }
const up = await connectUpstream({ url: env.WORKDAY_MCP_URL, accessToken: readSecretFile(env.WORKDAY_MCP_TOKEN_FILE, "WORKDAY_MCP_TOKEN_FILE") });
const listed = new Map((await up.listTools()).map((t) => [t.name, t]));
for (const e of APP_BUILDER_CATALOG) console.log(JSON.stringify({ tool: e.upstreamTool, wid: e.wid, present: listed.has(e.upstreamTool), inputSchema: listed.get(e.upstreamTool)?.inputSchema }));
if (env.WORKDAY_MCP_MAPPING_PATH) { const gw = await Gateway.create(up, loadMapping(env.WORKDAY_MCP_MAPPING_PATH), CAPS); for (const s of gw.capabilities()) console.log(JSON.stringify(s)); }
await up.close();
