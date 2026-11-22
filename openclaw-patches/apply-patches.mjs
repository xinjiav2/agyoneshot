#!/usr/bin/env node
/**
 * Applies the experimental `testing` OpenClaw speed optimizations:
 * - Installs pre-warmed 7-key contiguous shopify-catalog-mcp.mjs to ~/.openclaw/shopify-catalog-mcp.mjs
 * - Configures Cerebras transport in OpenClaw:
 *     - Skips background conversation-label requests on Cerebras to prevent 429 collisions
 *     - Ultra-lightweight channel for any "reply with ... ok" warmup ping (zero tools, max_completion_tokens: 32)
 *     - Single-turn context isolation on search_catalog turns + strips runtime-context preamble
 *     - temperature: 0, reasoning_effort: "low", max_completion_tokens: 768, prompt_cache_key
 *     - Removes inner 429 retry amplification inside doneDetectingFetch
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
console.log("Installed testing MCP server:", mcpDst);

// 2. Patch OpenClaw Cerebras transport block
const transportPath = path.join(
  home,
  ".npm-global/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist/openai-completions-transport-BGoKrb3z.mjs"
);
if (!fs.existsSync(transportPath)) {
  throw new Error(`OpenClaw transport file not found: ${transportPath}`);
}

let s = fs.readFileSync(transportPath, "utf8");

// No inner 429 retry loop inside doneDetectingFetch
const fetchStart = '\t\t\t\tconst doneDetectingFetch = async (url, init) => {';
const fetchEnd = '\t\t\t\t\tif (!response.body || !response.ok) return response;';
const fiStart = s.indexOf(fetchStart);
const fiEnd = s.indexOf(fetchEnd, fiStart);
if (fiStart === -1 || fiEnd === -1) throw new Error("doneDetectingFetch block not found");

const testingFetchHead = `\t\t\t\tconst doneDetectingFetch = async (url, init) => {
\t\t\t\t\tconst response = await baseFetch(url, init);
`;
s = s.slice(0, fiStart) + testingFetchHead + s.slice(fiEnd);

// Experimental Cerebras params block
const paramsStart = '\t\t\tlet params = builtParams;';
const paramsEnd = '\t\t\tconst encodeBody = prepareModelRequestBody(options);';
const piStart = s.indexOf(paramsStart);
const piEnd = s.indexOf(paramsEnd, piStart);
if (piStart === -1 || piEnd === -1) throw new Error("params block not found");

const testingParamsBlock = `\t\t\tlet params = builtParams;
\t\t\tif (model.provider === "cerebras" && params && typeof params === "object") {
\t\t\t\tconst _mTxt = JSON.stringify(params.messages ?? "");
\t\t\t\tif (!params.tools?.length && /conversation\\s+(?:label|title)|short\\s+title\\s+for\\s+this\\s+conversation/i.test(_mTxt)) {
\t\t\t\t\tthrow new Error("Skipped background conversation-label call on Cerebras");
\t\t\t\t}
\t\t\t\tparams.temperature = 0;
\t\t\t\tparams.reasoning_effort = "low";
\t\t\t\tif (options?.sessionId) params.prompt_cache_key = options.sessionId;
\t\t\t\tconst getText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => typeof b?.text === "string" ? b.text : "").join("") : "";
\t\t\t\tconst lastUserMsg = Array.isArray(params.messages) ? [...params.messages].reverse().find((m) => m?.role === "user") : null;
\t\t\t\tconst lastUserTxt = lastUserMsg ? getText(lastUserMsg.content) : "";
\t\t\t\tif (/\\breply\\s+with\\b.{0,25}\\bok\\b/i.test(lastUserTxt) && !lastUserTxt.includes("search_catalog")) {
\t\t\t\t\tdelete params.tools;
\t\t\t\t\tdelete params.tool_choice;
\t\t\t\t\tparams.messages = [{ role: "user", content: lastUserTxt.trim() }];
\t\t\t\t\tparams.max_completion_tokens = 32;
\t\t\t\t} else if (_mTxt.includes("search_catalog")) {
\t\t\t\t\tparams.max_completion_tokens = 768;
\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = 768;
\t\t\t\t\tif (Array.isArray(params.tools)) {
\t\t\t\t\t\tconst scTools = params.tools.filter((t) => (t?.function?.name ?? t?.name) === "search_catalog");
\t\t\t\t\t\tif (scTools.length > 0) {
\t\t\t\t\t\t\tparams.tools = scTools;
\t\t\t\t\t\t\tparams.parallel_tool_calls = true;
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tif (Array.isArray(params.messages)) {
\t\t\t\t\t\tlet lastScUserIdx = -1;
\t\t\t\t\t\tfor (let idx = params.messages.length - 1; idx >= 0; idx--) {
\t\t\t\t\t\t\tconst m = params.messages[idx];
\t\t\t\t\t\t\tif (m?.role === "user" && getText(m.content).includes("search_catalog")) {
\t\t\t\t\t\t\t\tlastScUserIdx = idx;
\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\tconst compactSys = {
\t\t\t\t\t\t\trole: "system",
\t\t\t\t\t\t\tcontent: "Fast shopping agent. Think max 3 words. Call search_catalog in parallel in 1 turn, then output raw single-line JSON copying each returned product object verbatim into {\\"gifts\\":[...]}."
\t\t\t\t\t\t};
\t\t\t\t\t\tif (lastScUserIdx >= 0) {
\t\t\t\t\t\t\tconst sliced = params.messages.slice(lastScUserIdx).map((m, i) => {
\t\t\t\t\t\t\t\tif (i === 0 && m?.role === "user") {
\t\t\t\t\t\t\t\t\tconst raw = getText(m.content);
\t\t\t\t\t\t\t\t\tconst cut = raw.indexOf("极速");
\t\t\t\t\t\t\t\t\treturn { role: "user", content: cut >= 0 ? raw.slice(cut) : raw };
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\treturn m;
\t\t\t\t\t\t\t});
\t\t\t\t\t\t\tparams.messages = [compactSys, ...sliced];
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
`;
s = s.slice(0, piStart) + testingParamsBlock + s.slice(piEnd);

fs.writeFileSync(transportPath, s, "utf8");
console.log("Applied experimental testing transport patch to:", transportPath);
console.log("Now restart OpenClaw: systemctl --user restart openclaw-gateway.service");
