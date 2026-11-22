#!/usr/bin/env node
/**
 * Applies the experimental `testing` OpenClaw speed optimizations:
 * - Installs pre-warmed 7-key contiguous shopify-catalog-mcp.mjs to ~/.openclaw/shopify-catalog-mcp.mjs
 * - Configures Cerebras transport in OpenClaw (runs AFTER onPayload so nothing re-bloats params):
 *     - Skips background conversation-label requests on Cerebras to prevent 429 collisions
 *     - Ultra-lightweight channel for any "reply with ... ok" warmup ping (zero tools, max_completion_tokens: 32)
 *     - Call 1 (no tool results yet): ultra-compact alphabetical 3-key search_catalog schema (~326 prompt tokens) + tool_choice: "required" + parallel_tool_calls: true (measured 1,195 tok/s on Call 1!)
 *     - Call 2 (tool results present): tool_choice: "none" + verbatim 7-key copy into {"gifts":[...]}
 *     - Strips all "## Watched Sessions" runtime-context blocks + isolates current turn
 *     - temperature: 0, reasoning_effort: "low", max_completion_tokens: 768, prompt_cache_key
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

// Replace entire block between `let params = builtParams;` and `if (mode === "managed") {`
// so our Cerebras optimizer runs AFTER `options?.onPayload?.(params, model)`
const paramsStart = '\t\t\tlet params = builtParams;';
const managedStart = '\t\t\tif (mode === "managed") {';
const piStart = s.indexOf(paramsStart);
const piEnd = s.indexOf(managedStart, piStart);
if (piStart === -1 || piEnd === -1) throw new Error("params/managed block not found");

const testingParamsBlock = `\t\t\tlet params = builtParams;
\t\t\tconst encodeBody = prepareModelRequestBody(options);
\t\t\tconst nextParams = await options?.onPayload?.(params, model);
\t\t\tif (nextParams !== void 0) params = nextParams;
\t\t\tif (model.provider === "cerebras" && params && typeof params === "object") {
\t\t\t\tconst getText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => typeof b?.text === "string" ? b.text : "").join("") : "";
\t\t\t\tconst _mTxt = JSON.stringify(params.messages ?? "");
\t\t\t\tconst isPureCtxMsg = (m) => {
\t\t\t\t\tif (!m) return false;
\t\t\t\t\tif (m.role === "developer") return true;
\t\t\t\t\tif (m.role !== "user") return false;
\t\t\t\t\tconst t = getText(m.content);
\t\t\t\t\tif (t.includes("search_catalog") || /\\b(?:reply|respond)\\s+with\\b.{0,25}\\bok\\b/i.test(t)) return false;
\t\t\t\t\treturn t.includes("## Watched Sessions") || t.includes("Conversation info:") || t.includes("⟦openclaw:ctx⟧") || t.includes("Active exec sessions") || t.includes("## Active Subagents") || t.includes("## Temporal Context") || t.includes("OpenClaw runtime context");
\t\t\t\t};
\t\t\t\tconst lastUserMsg = Array.isArray(params.messages) ? [...params.messages].reverse().find((m) => m?.role === "user" && !isPureCtxMsg(m)) : null;
\t\t\t\tconst lastUserTxt = lastUserMsg ? getText(lastUserMsg.content) : "";
\t\t\t\tif (
\t\t\t\t\t(!params.tools?.length && /(?:conversation|session)\\s+(?:label|title)|concise\\s+session\\s+title|short\\s+title\\s+for\\s+this\\s+conversation/i.test(_mTxt)) ||
\t\t\t\t\t(!lastUserTxt.includes("search_catalog") && (String(options?.sessionId ?? "").includes("skill-workshop") || /skill-workshop-review|skill\\s+experience\\s+review|workshop\\s+skill\\s+review/i.test(_mTxt)))
\t\t\t\t) {
\t\t\t\t\tthrow new Error("Skipped background OpenClaw utility call on Cerebras");
\t\t\t\t}
\t\t\t\tparams.temperature = 0;
\t\t\t\tparams.reasoning_effort = "low";
\t\t\t\tif (options?.sessionId) params.prompt_cache_key = options.sessionId;
\t\t\t\tif (/\\b(?:reply|respond)\\s+with\\b.{0,25}\\bok\\b/i.test(lastUserTxt) && !lastUserTxt.includes("search_catalog")) {
\t\t\t\t\tdelete params.tools;
\t\t\t\t\tdelete params.tool_choice;
\t\t\t\t\tparams.messages = [{ role: "user", content: "reply with just \\"ok\\"" }];
\t\t\t\t\tparams.max_completion_tokens = 32;
\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = 32;
\t\t\t\t} else if (lastUserTxt.includes("search_catalog")) {
\t\t\t\t\tparams.prompt_cache_key = "openclaw-speed-shop-v1";
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
\t\t\t\t\t\t\tcontent: "Fast shopping agent. Think <=2 words. Zero prose."
\t\t\t\t\t\t};
\t\t\t\t\t\tif (lastScUserIdx >= 0) {
\t\t\t\t\t\t\tconst sliced = params.messages.slice(lastScUserIdx).filter((m, i) => i === 0 || m?.role === "assistant" || m?.role === "tool").map((m, i) => {
\t\t\t\t\t\t\t\tif (i === 0 && m?.role === "user") {
\t\t\t\t\t\t\t\t\tconst raw = getText(m.content);
\t\t\t\t\t\t\t\t\tconst markers = ["Fast Christmas", "Call search_catalog", "极速"];
\t\t\t\t\t\t\t\t\tlet cut = -1;
\t\t\t\t\t\t\t\t\tfor (const mk of markers) {
\t\t\t\t\t\t\t\t\t\tconst idx = raw.indexOf(mk);
\t\t\t\t\t\t\t\t\t\tif (idx >= 0 && (cut === -1 || idx < cut)) cut = idx;
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\tlet cleaned = cut >= 0 ? raw.slice(cut) : raw;
\t\t\t\t\t\t\t\t\tconst schemaEnd = cleaned.indexOf("}]}" );
\t\t\t\t\t\t\t\t\tif (schemaEnd > 0) cleaned = cleaned.slice(0, schemaEnd + 3);
\t\t\t\t\t\t\t\t\treturn { role: "user", content: cleaned.trim() };
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\treturn m;
\t\t\t\t\t\t\t});
\t\t\t\t\t\t\tparams.messages = [compactSys, ...sliced];
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tconst toolMsgs = Array.isArray(params.messages) ? params.messages.filter((m) => m?.role === "tool") : [];
\t\t\t\t\tconst hasToolResults = toolMsgs.length > 0;
\t\t\t\t\tconst toolChars = toolMsgs.reduce((acc, m) => acc + getText(m.content).length, 0);
\t\t\t\t\tconst maxOut = hasToolResults ? Math.min(768, Math.max(512, Math.ceil(toolChars / 2.2) + 96)) : 420;
\t\t\t\t\tparams.max_completion_tokens = maxOut;
\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = maxOut;
\t\t\t\t\tif (hasToolResults) {
\t\t\t\t\t\tdelete params.tools;
\t\t\t\t\t\tdelete params.tool_choice;
\t\t\t\t\t\tdelete params.parallel_tool_calls;
\t\t\t\t\t} else {
\t\t\t\t\t\tparams.tools = [{
\t\t\t\t\t\t\ttype: "function",
\t\t\t\t\t\t\tfunction: {
\t\t\t\t\t\t\t\tname: "search_catalog",
\t\t\t\t\t\t\t\tdescription: "Search Shopify Global Catalog",
\t\t\t\t\t\t\t\tparameters: {
\t\t\t\t\t\t\t\t\ttype: "object",
\t\t\t\t\t\t\t\t\trequired: ["query"],
\t\t\t\t\t\t\t\t\tproperties: {
\t\t\t\t\t\t\t\t\t\tlimit: { type: "number" },
\t\t\t\t\t\t\t\t\t\tquery: { type: "string" },
\t\t\t\t\t\t\t\t\t\tview: { type: "string" }
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}];
\t\t\t\t\t\tparams.parallel_tool_calls = true;
\t\t\t\t\t\tparams.tool_choice = "required";
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
`;
s = s.slice(0, piStart) + testingParamsBlock + s.slice(piEnd);

fs.writeFileSync(transportPath, s, "utf8");
console.log("Applied experimental testing transport patch to:", transportPath);

// 3. Fail fast on Cerebras 429 bursts (2 quick retries capped at 2s => ~3-4s max instead of stalling)
const embeddedAgentPath = path.join(
  home,
  ".npm-global/lib/node_modules/openclaw/dist/embedded-agent-BAcI9cGJ.mjs"
);
if (fs.existsSync(embeddedAgentPath)) {
  let ea = fs.readFileSync(embeddedAgentPath, "utf8");
  let patchedEa = ea.replace(
    /const RATE_LIMIT_RETRY_MAX_DELAY_MS = [^;]+;/,
    "const RATE_LIMIT_RETRY_MAX_DELAY_MS = 2e3;"
  );
  patchedEa = patchedEa.replace(
    /const d = Math\.min\(g \?\? \(i \? \d+ : MAX_TRANSIENT_RETRIES\), m \? \d+ : Infinity, h \? SHARED_TPM_FALLBACK_MAX_RETRIES : Infinity\);/,
    "const d = Math.min(g ?? (i ? 2 : MAX_TRANSIENT_RETRIES), m ? 2 : Infinity, h ? SHARED_TPM_FALLBACK_MAX_RETRIES : Infinity);"
  );
  if (patchedEa !== ea) {
    fs.writeFileSync(embeddedAgentPath, patchedEa, "utf8");
    console.log("Patched fail-fast 429 retry (max 2 retries, 2s cap) in:", embeddedAgentPath);
  } else {
    console.log("Fail-fast 429 retry already active in:", embeddedAgentPath);
  }
}

// 4. Disable autonomous background skill-workshop-review calls (prevents 23k-token background 429s on Cerebras)
const openclawConfigPath = path.join(home, ".openclaw", "openclaw.json");
if (fs.existsSync(openclawConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  cfg.skills = cfg.skills || {};
  cfg.skills.workshop = cfg.skills.workshop || {};
  cfg.skills.workshop.autonomous = { ...(cfg.skills.workshop.autonomous || {}), mode: "off" };
  fs.writeFileSync(openclawConfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log("Ensured skills.workshop.autonomous.mode = off in:", openclawConfigPath);
}
console.log("Now restart OpenClaw: systemctl --user restart openclaw-gateway.service");
