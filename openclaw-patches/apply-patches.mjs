#!/usr/bin/env node
/**
 * Restores 100% Stock Default OpenClaw Configuration & Transport (branch: stock-prompt).
 * - Removes ALL custom Cerebras request/message/tool overrides from openai-completions-transport-BGoKrb3z.mjs
 *   (leaving ONLY the official serverTps telemetry + Control UI pill/Cart display intact).
 * - Removes custom Shopify MCP server & restores default OpenClaw tool profile in ~/.openclaw/openclaw.json.
 * - All speed optimizations on this branch are 100% PURE PROMPT STEERING on stock OpenClaw!
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

// 1. Restore stock OpenClaw Cerebras transport block (zero custom request overrides)
const transportPath = path.join(
  home,
  ".npm-global/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist/openai-completions-transport-BGoKrb3z.mjs"
);
if (!fs.existsSync(transportPath)) {
  throw new Error(`OpenClaw transport file not found: ${transportPath}`);
}

let s = fs.readFileSync(transportPath, "utf8");
const paramsStart = '\t\t\tlet params = builtParams;';
const managedStart = '\t\t\tif (mode === "managed") {';
const piStart = s.indexOf(paramsStart);
const piEnd = s.indexOf(managedStart, piStart);
if (piStart === -1 || piEnd === -1) throw new Error("params/managed block not found");

const stockParamsBlock = `\t\t\tlet params = builtParams;
\t\t\tconst encodeBody = prepareModelRequestBody(options);
\t\t\tconst nextParams = await options?.onPayload?.(params, model);
\t\t\tif (nextParams !== void 0) params = nextParams;
`;
s = s.slice(0, piStart) + stockParamsBlock + s.slice(piEnd);
fs.writeFileSync(transportPath, s, "utf8");
console.log("Restored 100% stock OpenClaw transport (zero custom Cerebras overrides):", transportPath);

// 2. Restore default OpenClaw config in ~/.openclaw/openclaw.json (no custom MCP, default tool profile)
const openclawConfigPath = path.join(home, ".openclaw", "openclaw.json");
if (fs.existsSync(openclawConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  if (cfg.mcp?.servers?.shopify) delete cfg.mcp.servers.shopify;
  if (cfg.mcp?.servers && Object.keys(cfg.mcp.servers).length === 0) delete cfg.mcp.servers;
  if (cfg.mcp && Object.keys(cfg.mcp).length === 0) delete cfg.mcp;
  if (cfg.tools?.profile) delete cfg.tools.profile;
  if (cfg.browser) delete cfg.browser;
  fs.writeFileSync(openclawConfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log("Restored default OpenClaw configuration (no MCP, default tool profile):", openclawConfigPath);
}
console.log("Now restart OpenClaw: systemctl --user restart openclaw-gateway.service");
