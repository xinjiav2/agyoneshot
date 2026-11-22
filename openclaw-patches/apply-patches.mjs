#!/usr/bin/env node
/**
 * Applies the stable high-speed AU/AUD OpenClaw configuration (pre-USD baseline):
 * - Installs shopify-catalog-mcp.mjs to ~/.openclaw/shopify-catalog-mcp.mjs
 * - Configures Cerebras transport in OpenClaw:
 *     - temperature: 0, reasoning_effort: "low", max_completion_tokens <= 1536
 *     - Exposes only search_catalog + parallel_tool_calls: true on search_catalog turns
 *     - Compact 1-line shopping system prompt + strips "## Watched Sessions" runtime context
 *     - Transparent 429 retry inside doneDetectingFetch
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();

// 1. Install shopify-catalog-mcp.mjs
const mcpSrc = path.join(__dirname, "shopify-catalog-mcp.mjs");
const mcpDst = path.join(home, ".openclaw", "shopify-catalog-mcp.mjs");
fs.mkdirSync(path.dirname(mcpDst), { recursive: true });
fs.copyFileSync(mcpSrc, mcpDst);
fs.chmodSync(mcpDst, 0o755);
console.log("Installed:", mcpDst);

// 2. Patch OpenClaw Cerebras transport block
const transportPath = path.join(
  home,
  ".npm-global/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist/openai-completions-transport-BGoKrb3z.mjs"
);
if (!fs.existsSync(transportPath)) {
  throw new Error(`OpenClaw transport file not found: ${transportPath}`);
}

let s = fs.readFileSync(transportPath, "utf8");

// Ensure doneDetectingFetch uses the baseline 4x 429 retry backoff
const fetchStart = '\t\t\t\tconst doneDetectingFetch = async (url, init) => {';
const fetchEnd = '\t\t\t\t\tif (!response.body || !response.ok) return response;';
const fiStart = s.indexOf(fetchStart);
const fiEnd = s.indexOf(fetchEnd, fiStart);
if (fiStart === -1 || fiEnd === -1) throw new Error("doneDetectingFetch block not found");

const baselineFetchHead = `\t\t\t\tconst doneDetectingFetch = async (url, init) => {
\t\t\t\t\tlet response = await baseFetch(url, init);
\t\t\t\t\tif (model.provider === "cerebras" && response.status === 429) {
\t\t\t\t\t\tfor (let retry = 1; retry <= 4 && response.status === 429; retry++) {
\t\t\t\t\t\t\tawait new Promise((r) => setTimeout(r, 650 * retry + Math.floor(Math.random() * 350)));
\t\t\t\t\t\t\tresponse = await baseFetch(url, init);
\t\t\t\t\t\t}
\t\t\t\t\t}
`;
s = s.slice(0, fiStart) + baselineFetchHead + s.slice(fiEnd);

// Ensure Cerebras params block matches the exact pre-USD AU/AUD best baseline
const paramsStart = '\t\t\tlet params = builtParams;';
const paramsEnd = '\t\t\tconst encodeBody = prepareModelRequestBody(options);';
const piStart = s.indexOf(paramsStart);
const piEnd = s.indexOf(paramsEnd, piStart);
if (piStart === -1 || piEnd === -1) throw new Error("params block not found");

const baselineParamsBlock = `\t\t\tlet params = builtParams;
\t\t\tif (model.provider === "cerebras" && params && typeof params === "object") {
\t\t\t\tparams.temperature = 0;
\t\t\t\tparams.reasoning_effort = "low";
\t\t\t\tif (typeof params.max_completion_tokens === "number" && params.max_completion_tokens > 1536) params.max_completion_tokens = 1536;
\t\t\t\tif (typeof params.max_tokens === "number" && params.max_tokens > 1536) params.max_tokens = 1536;
\t\t\t\tconst msgText = JSON.stringify(params.messages ?? "");
\t\t\t\tif (msgText.includes("search_catalog") && Array.isArray(params.tools)) {
\t\t\t\t\tconst scTools = params.tools.filter((t) => (t?.function?.name ?? t?.name) === "search_catalog");
\t\t\t\t\tif (scTools.length > 0) {
\t\t\t\t\t\tparams.tools = scTools;
\t\t\t\t\t\tparams.parallel_tool_calls = true;
\t\t\t\t\t}
\t\t\t\t\tif (Array.isArray(params.messages)) {
\t\t\t\t\t\tparams.messages = params.messages.filter((m) => !(m?.role === "user" && typeof m?.content === "string" && m.content.startsWith("## Watched Sessions"))).map((m) => (m?.role === "system" || m?.role === "developer") && typeof m?.content === "string" && m.content.length > 300 ? {
\t\t\t\t\t\t\t...m,
\t\t\t\t\t\t\tcontent: "Fast shopping agent. Think max 5 words. Call search_catalog in parallel in 1 turn, then output raw single-line JSON copying name, url, store, price_aud verbatim."
\t\t\t\t\t\t} : m);
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
`;
s = s.slice(0, piStart) + baselineParamsBlock + s.slice(piEnd);

fs.writeFileSync(transportPath, s, "utf8");
console.log("Applied pre-USD AU/AUD baseline transport patch to:", transportPath);
console.log("Now restart OpenClaw: systemctl --user restart openclaw-gateway.service");
