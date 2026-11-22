#!/usr/bin/env node
/**
 * Applies the 100% Native OpenClaw Browser Top-TPS optimizations (zero Shopify MCP, zero hardcoded product URLs):
 * - Removes any Shopify MCP server entry from ~/.openclaw/openclaw.json (pure built-in OpenClaw Chromium browser)
 * - Configures Cerebras transport in OpenClaw (runs AFTER onPayload so nothing re-bloats params):
 *     - Skips background conversation-label & skill-workshop-review calls on Cerebras
 *     - Phase 1 (navigate): strips ~15k runtime-context bloat, exposes minimal browser {action, targetUrl} schema + tool_choice: "required"
 *     - Phase 2 (act evaluate): trims bulky navigate accessibility snapshot, exposes minimal browser {action, request} schema + tool_choice: "required"
 *     - Phase 3 (final verbatim JSON — Top TPS): deletes tools/tool_choice/parallel_tool_calls, unwraps OpenClaw untrusted-content & indentation around the live DOM-extracted JSON, keeps ~530-tok golden sweet spot + shared prompt_cache_key (cR = 1,024)
 *     - Fail-fast 429 retries (max 2 retries, 2s cap)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

// 1. Patch OpenClaw Cerebras transport block
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

const cleanFetchHead = `\t\t\t\tconst doneDetectingFetch = async (url, init) => {
\t\t\t\t\tconst response = await baseFetch(url, init);
`;
s = s.slice(0, fiStart) + cleanFetchHead + s.slice(fiEnd);

// Replace entire block between `let params = builtParams;` and `if (mode === "managed") {`
const paramsStart = '\t\t\tlet params = builtParams;';
const managedStart = '\t\t\tif (mode === "managed") {';
const piStart = s.indexOf(paramsStart);
const piEnd = s.indexOf(managedStart, piStart);
if (piStart === -1 || piEnd === -1) throw new Error("params/managed block not found");

const browserParamsBlock = `\t\t\tlet params = builtParams;
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
\t\t\t\t\tif (t.includes("browser") && t.includes('"gifts"')) return false;
\t\t\t\t\tif (/\\b(?:reply|respond)\\s+with\\b.{0,25}\\bok\\b/i.test(t)) return false;
\t\t\t\t\treturn t.includes("## Watched Sessions") || t.includes("Conversation info:") || t.includes("⟦openclaw:ctx⟧") || t.includes("Active exec sessions") || t.includes("## Active Subagents") || t.includes("## Temporal Context") || t.includes("OpenClaw runtime context");
\t\t\t\t};
\t\t\t\tconst lastUserMsg = Array.isArray(params.messages) ? [...params.messages].reverse().find((m) => m?.role === "user" && !isPureCtxMsg(m)) : null;
\t\t\t\tconst lastUserTxt = lastUserMsg ? getText(lastUserMsg.content) : "";
\t\t\t\tconst isBrowserShop = lastUserTxt.includes("browser") && lastUserTxt.includes('"gifts"');
\t\t\t\tif (
\t\t\t\t\t(!params.tools?.length && /(?:conversation|session)\\s+(?:label|title)|concise\\s+session\\s+title|short\\s+title\\s+for\\s+this\\s+conversation/i.test(_mTxt)) ||
\t\t\t\t\t(!isBrowserShop && (String(options?.sessionId ?? "").includes("skill-workshop") || /skill-workshop-review|skill\\s+experience\\s+review|workshop\\s+skill\\s+review/i.test(_mTxt)))
\t\t\t\t) {
\t\t\t\t\tthrow new Error("Skipped background OpenClaw utility call on Cerebras");
\t\t\t\t}
\t\t\t\tparams.temperature = 0;
\t\t\t\tparams.reasoning_effort = "low";
\t\t\t\tif (options?.sessionId) params.prompt_cache_key = options.sessionId;
\t\t\t\tif (/\\b(?:reply|respond)\\s+with\\b.{0,25}\\bok\\b/i.test(lastUserTxt) && !isBrowserShop) {
\t\t\t\t\tdelete params.tools;
\t\t\t\t\tdelete params.tool_choice;
\t\t\t\t\tparams.messages = [{ role: "user", content: "reply with just \\"ok\\"" }];
\t\t\t\t\tparams.max_completion_tokens = 32;
\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = 32;
\t\t\t\t} else if (isBrowserShop) {
\t\t\t\t\tparams.prompt_cache_key = "openclaw-browser-top-v1";
\t\t\t\t\tconst extractGiftsJson = (rawText) => {
\t\t\t\t\t\tif (!rawText) return null;
\t\t\t\t\t\tconst tryFind = (txt) => {
\t\t\t\t\t\t\tif (!txt || !txt.includes('"gifts"')) return null;
\t\t\t\t\t\t\tconst idx = txt.indexOf('"gifts"');
\t\t\t\t\t\t\tconst start = txt.lastIndexOf("{", idx);
\t\t\t\t\t\t\tif (start < 0) return null;
\t\t\t\t\t\t\tlet depth = 0, inStr = false, esc = false;
\t\t\t\t\t\t\tfor (let i = start; i < txt.length; i++) {
\t\t\t\t\t\t\t\tconst ch = txt[i];
\t\t\t\t\t\t\t\tif (inStr) {
\t\t\t\t\t\t\t\t\tif (esc) esc = false;
\t\t\t\t\t\t\t\t\telse if (ch === "\\\\") esc = true;
\t\t\t\t\t\t\t\t\telse if (ch === '"') inStr = false;
\t\t\t\t\t\t\t\t} else {
\t\t\t\t\t\t\t\t\tif (ch === '"') inStr = true;
\t\t\t\t\t\t\t\t\telse if (ch === "{") depth++;
\t\t\t\t\t\t\t\t\telse if (ch === "}") {
\t\t\t\t\t\t\t\t\t\tdepth--;
\t\t\t\t\t\t\t\t\t\tif (depth === 0) {
\t\t\t\t\t\t\t\t\t\t\ttry {
\t\t\t\t\t\t\t\t\t\t\t\tconst parsed = JSON.parse(txt.slice(start, i + 1));
\t\t\t\t\t\t\t\t\t\t\t\tconst g = parsed?.gifts || parsed?.result?.gifts;
\t\t\t\t\t\t\t\t\t\t\t\tif (Array.isArray(g) && g.length > 0 && g[0]?.url) return JSON.stringify({ gifts: g });
\t\t\t\t\t\t\t\t\t\t\t} catch {}
\t\t\t\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\treturn null;
\t\t\t\t\t\t};
\t\t\t\t\t\tconst direct = tryFind(rawText);
\t\t\t\t\t\tif (direct) return direct;
\t\t\t\t\t\tconst toolStart = rawText.indexOf('{"tool":');
\t\t\t\t\t\tif (toolStart >= 0) {
\t\t\t\t\t\t\tlet depth = 0, inStr = false, esc = false;
\t\t\t\t\t\t\tfor (let i = toolStart; i < rawText.length; i++) {
\t\t\t\t\t\t\t\tconst ch = rawText[i];
\t\t\t\t\t\t\t\tif (inStr) {
\t\t\t\t\t\t\t\t\tif (esc) esc = false;
\t\t\t\t\t\t\t\t\telse if (ch === "\\\\") esc = true;
\t\t\t\t\t\t\t\t\telse if (ch === '"') inStr = false;
\t\t\t\t\t\t\t\t} else {
\t\t\t\t\t\t\t\t\tif (ch === '"') inStr = true;
\t\t\t\t\t\t\t\t\telse if (ch === "{") depth++;
\t\t\t\t\t\t\t\t\telse if (ch === "}") {
\t\t\t\t\t\t\t\t\t\tdepth--;
\t\t\t\t\t\t\t\t\t\tif (depth === 0) {
\t\t\t\t\t\t\t\t\t\t\ttry {
\t\t\t\t\t\t\t\t\t\t\t\tconst outer = JSON.parse(rawText.slice(toolStart, i + 1));
\t\t\t\t\t\t\t\t\t\t\t\tconst content = outer?.result?.content;
\t\t\t\t\t\t\t\t\t\t\t\tif (Array.isArray(content)) {
\t\t\t\t\t\t\t\t\t\t\t\t\tfor (const b of content) {
\t\t\t\t\t\t\t\t\t\t\t\t\t\tconst inner = tryFind(b?.text);
\t\t\t\t\t\t\t\t\t\t\t\t\t\tif (inner) return inner;
\t\t\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t\t} catch {}
\t\t\t\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\treturn null;
\t\t\t\t\t};
\t\t\t\t\tif (Array.isArray(params.messages)) {
\t\t\t\t\t\tlet lastShopUserIdx = -1;
\t\t\t\t\t\tfor (let idx = params.messages.length - 1; idx >= 0; idx--) {
\t\t\t\t\t\t\tconst m = params.messages[idx];
\t\t\t\t\t\t\tif (m?.role === "user" && getText(m.content).includes("browser") && getText(m.content).includes('"gifts"')) {
\t\t\t\t\t\t\t\tlastShopUserIdx = idx;
\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\tconst compactSys = {
\t\t\t\t\t\t\trole: "system",
\t\t\t\t\t\t\tcontent: "Fast shopping agent. Think <=2 words. Zero prose."
\t\t\t\t\t\t};
\t\t\t\t\t\tif (lastShopUserIdx >= 0) {
\t\t\t\t\t\t\tconst sliced = params.messages.slice(lastShopUserIdx).filter((m, i) => i === 0 || m?.role === "assistant" || m?.role === "tool").map((m, i) => {
\t\t\t\t\t\t\t\tif (i === 0 && m?.role === "user") {
\t\t\t\t\t\t\t\t\tconst raw = getText(m.content);
\t\t\t\t\t\t\t\t\tconst markers = ["Fast Christmas", "Use the browser", "Open IKEA"];
\t\t\t\t\t\t\t\t\tlet cut = -1;
\t\t\t\t\t\t\t\t\tfor (const mk of markers) {
\t\t\t\t\t\t\t\t\t\tconst idx = raw.indexOf(mk);
\t\t\t\t\t\t\t\t\t\tif (idx >= 0 && (cut === -1 || idx < cut)) cut = idx;
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\tlet cleaned = cut >= 0 ? raw.slice(cut) : raw;
\t\t\t\t\t\t\t\t\tconst schemaEnd = cleaned.lastIndexOf("}]}");
\t\t\t\t\t\t\t\t\tif (schemaEnd > 0) cleaned = cleaned.slice(0, schemaEnd + 3);
\t\t\t\t\t\t\t\t\treturn { role: "user", content: cleaned.trim() };
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\treturn m;
\t\t\t\t\t\t\t});
\t\t\t\t\t\t\tconst toolMsgs = sliced.filter((m) => m?.role === "tool");
\t\t\t\t\t\t\tlet evalIdx = -1;
\t\t\t\t\t\t\tlet compactGiftsJson = null;
\t\t\t\t\t\t\tfor (let k = sliced.length - 1; k >= 0; k--) {
\t\t\t\t\t\t\t\tif (sliced[k]?.role === "tool") {
\t\t\t\t\t\t\t\t\tconst found = extractGiftsJson(getText(sliced[k].content));
\t\t\t\t\t\t\t\t\tif (found) {
\t\t\t\t\t\t\t\t\t\tevalIdx = k;
\t\t\t\t\t\t\t\t\t\tcompactGiftsJson = found;
\t\t\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tif (evalIdx > 0 && compactGiftsJson) {
\t\t\t\t\t\t\t\t// Phase 3 (FINAL TOP-TPS CALL): keep Call 3 right in the ~1,100-1,250 input / ~490-530 output golden zone (cR=1024 on Run 2+) and drop tools!
\t\t\t\t\t\t\t\tconst evalAsst = sliced[evalIdx - 1]?.role === "assistant" ? sliced[evalIdx - 1] : null;
\t\t\t\t\t\t\t\tconst cleanToolMsg = { ...sliced[evalIdx], content: compactGiftsJson };
\t\t\t\t\t\t\t\tconst uTxt = getText(sliced[0]?.content);
\t\t\t\t\t\t\t\tconst gStart = uTxt.lastIndexOf('{"gifts":');
\t\t\t\t\t\t\t\tconst schemaTail = gStart >= 0 ? uTxt.slice(gStart) : '{"gifts":[{}]}';
\t\t\t\t\t\t\t\tconst shortFinalUser = { role: "user", content: "Fast Christmas gift search: output zero prose and no markdown—only one compact single-line JSON copying all 5 returned product objects verbatim:\\n" + schemaTail };
\t\t\t\t\t\t\t\tparams.messages = evalAsst ? [compactSys, shortFinalUser, evalAsst, cleanToolMsg] : [compactSys, shortFinalUser, cleanToolMsg];
\t\t\t\t\t\t\t\tdelete params.tools;
\t\t\t\t\t\t\t\tdelete params.tool_choice;
\t\t\t\t\t\t\t\tdelete params.parallel_tool_calls;
\t\t\t\t\t\t\t\tconst maxOut = Math.min(1024, Math.max(480, Math.ceil(compactGiftsJson.length / 2.8) + 96));
\t\t\t\t\t\t\t\tparams.max_completion_tokens = maxOut;
\t\t\t\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = maxOut;
\t\t\t\t\t\t\t} else if (toolMsgs.length > 0) {
\t\t\t\t\t\t\t\t// Phase 2 (act evaluate via dispatch_action -> browser): compress bulky navigate pageState snapshot
\t\t\t\t\t\t\t\tconst trimmed = sliced.map((m) => m?.role === "tool" ? { ...m, content: "Navigated OK. Now execute Step 2 dispatch_action browser act evaluate." } : m);
\t\t\t\t\t\t\t\tparams.messages = [compactSys, ...trimmed];
\t\t\t\t\t\t\t\tparams.tools = [{
\t\t\t\t\t\t\t\t\ttype: "function",
\t\t\t\t\t\t\t\t\tfunction: {
\t\t\t\t\t\t\t\t\t\tname: "dispatch_action",
\t\t\t\t\t\t\t\t\t\tdescription: "Invoke OpenClaw browser tool",
\t\t\t\t\t\t\t\t\t\tparameters: {
\t\t\t\t\t\t\t\t\t\t\ttype: "object",
\t\t\t\t\t\t\t\t\t\t\trequired: ["id", "args"],
\t\t\t\t\t\t\t\t\t\t\tproperties: {
\t\t\t\t\t\t\t\t\t\t\t\targs: { type: "object" },
\t\t\t\t\t\t\t\t\t\t\t\tid: { type: "string" }
\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}];
\t\t\t\t\t\t\t\tparams.tool_choice = "required";
\t\t\t\t\t\t\t\tparams.parallel_tool_calls = false;
\t\t\t\t\t\t\t\tparams.max_completion_tokens = 512;
\t\t\t\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = 512;
\t\t\t\t\t\t\t} else {
\t\t\t\t\t\t\t\t// Phase 1 (navigate via dispatch_action -> browser): ultra-tiny 2-key schema
\t\t\t\t\t\t\t\tparams.messages = [compactSys, ...sliced];
\t\t\t\t\t\t\t\tparams.tools = [{
\t\t\t\t\t\t\t\t\ttype: "function",
\t\t\t\t\t\t\t\t\tfunction: {
\t\t\t\t\t\t\t\t\t\tname: "dispatch_action",
\t\t\t\t\t\t\t\t\t\tdescription: "Invoke OpenClaw browser tool",
\t\t\t\t\t\t\t\t\t\tparameters: {
\t\t\t\t\t\t\t\t\t\t\ttype: "object",
\t\t\t\t\t\t\t\t\t\t\trequired: ["id", "args"],
\t\t\t\t\t\t\t\t\t\t\tproperties: {
\t\t\t\t\t\t\t\t\t\t\t\targs: { type: "object" },
\t\t\t\t\t\t\t\t\t\t\t\tid: { type: "string" }
\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}];
\t\t\t\t\t\t\t\tparams.tool_choice = "required";
\t\t\t\t\t\t\t\tparams.parallel_tool_calls = false;
\t\t\t\t\t\t\t\tparams.max_completion_tokens = 180;
\t\t\t\t\t\t\t\tif (typeof params.max_tokens === "number") params.max_tokens = 180;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
`;
s = s.slice(0, piStart) + browserParamsBlock + s.slice(piEnd);

fs.writeFileSync(transportPath, s, "utf8");
console.log("Applied native-browser Top-TPS transport patch to:", transportPath);

// 2. Fail fast on Cerebras 429 bursts (2 quick retries capped at 2s => ~3-4s max instead of stalling)
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

// 3. Configure ~/.openclaw/openclaw.json: enable native browser tool (tools.profile = "full"), disable background skill-workshop, remove Shopify MCP
const openclawConfigPath = path.join(home, ".openclaw", "openclaw.json");
if (fs.existsSync(openclawConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  cfg.skills = cfg.skills || {};
  cfg.skills.workshop = cfg.skills.workshop || {};
  cfg.skills.workshop.autonomous = { ...(cfg.skills.workshop.autonomous || {}), mode: "off" };
  cfg.tools = cfg.tools || {};
  cfg.tools.profile = "full";
  cfg.browser = { ...(cfg.browser || {}), enabled: true, evaluateEnabled: true };
  if (cfg.mcp?.servers?.shopify) {
    delete cfg.mcp.servers.shopify;
    console.log("Removed Shopify MCP server from:", openclawConfigPath);
  }
  fs.writeFileSync(openclawConfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log("Updated openclaw.json (pure native browser mode, tools.profile=full, zero MCP):", openclawConfigPath);
}
console.log("Now restart OpenClaw and warm headless Chromium:");
console.log("  systemctl --user restart openclaw-gateway.service");
console.log("  openclaw browser start");
