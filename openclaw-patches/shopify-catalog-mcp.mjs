#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const DISK_CACHE_PATH = "/tmp/shopify-au-warm-cache.json";
const DISK_CACHE_TTL_MS = 5 * 60 * 1000;

const SHOPIFY_MCP_URL = "https://catalog.shopify.com/api/ucp/mcp";
const SHOPIFY_PROFILE_URL =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json";

function parseJsonOrSse(rawText) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  let lastObj = null;
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      lastObj = obj;
      if (obj?.result || obj?.error) return obj;
    } catch {
      // ignore
    }
  }
  return lastObj;
}

function cleanPlainText(raw, fallback = "", maxLen = 240) {
  let s = "";
  if (typeof raw === "string") s = raw;
  else if (raw && typeof raw === "object") s = String(raw.plain || raw.text || raw.value || "");
  s = s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&quot;|&#34;|&apos;|&#39;/gi, "")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[^A-Za-z0-9.,\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return fallback;
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

async function queryShopifyCatalog(query, limit = 1, withShipsToFilter = true) {
  const catalog = {
    query: String(query || "").trim() || "gift",
    view: "compact",
    pagination: { limit: Math.min(5, Math.max(1, Number(limit) || 1)) },
    context: { address_country: "AU", currency: "AUD" },
  };
  if (withShipsToFilter) {
    catalog.filters = { ships_to: { country: "AU" } };
  }

  const rpcBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        meta: {
          "ucp-agent": {
            profile: SHOPIFY_PROFILE_URL,
          },
        },
        catalog,
      },
    },
  };

  const res = await fetch(SHOPIFY_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(rpcBody),
    signal: AbortSignal.timeout(12000),
  });

  const text = await res.text();
  const parsed = parseJsonOrSse(text);
  const rawProducts = parsed?.result?.structuredContent?.products || [];

  const qLower = String(query || "").toLowerCase();
  const audience = qLower.includes("kid")
    ? "kids"
    : qLower.includes("teen") || qLower.includes("desk")
      ? "teens"
      : qLower.includes("blanket") || qLower.includes("grand")
        ? "grandparents"
        : qLower.includes("pet") || qLower.includes("dog") || qLower.includes("cat")
          ? "pets"
          : "adults";

  const items = [];
  for (const p of rawProducts) {
    const v = Array.isArray(p?.variants) && p.variants.length > 0 ? p.variants[0] : null;
    if (!v || !v.url) continue;
    const rawAmount = v.price?.amount;
    const price =
      typeof rawAmount === "number"
        ? Number((rawAmount / 100).toFixed(2))
        : typeof rawAmount === "string" && !Number.isNaN(Number(rawAmount))
          ? Number((Number(rawAmount) / 100).toFixed(2))
          : null;
    const title = String(p.title || v.title || "").replace(/["\\\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    const store = String(v.seller?.name || "").replace(/["\\\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    items.push({
      name: title,
      url: String(v.url),
      price_aud: price,
      store,
      audience,
      description: title,
      reason: "Great Christmas gift",
    });
  }

  if (items.length === 0 && withShipsToFilter) {
    return queryShopifyCatalog(query, limit, false);
  }

  return items;
}

const WARM_CACHE = new Map();
const WARM_INFLIGHT = new Map();
const PREWARM_QUERIES = ["kids toy", "teen desk", "candle", "blanket", "pet toy"];

function loadDiskCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, "utf8"));
    const now = Date.now();
    if (raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object") {
      for (const [k, v] of Object.entries(raw.entries)) {
        if (v && Array.isArray(v.items) && v.items.length > 0 && now - (v.ts || 0) < DISK_CACHE_TTL_MS) {
          WARM_CACHE.set(k, v.items);
        }
      }
    }
  } catch {}
}

function saveDiskCache() {
  try {
    const now = Date.now();
    const entries = {};
    for (const [k, items] of WARM_CACHE.entries()) {
      entries[k] = { ts: now, items };
    }
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify({ entries }), "utf8");
  } catch {}
}

loadDiskCache();

function fetchWithDedup(query, limit) {
  const key = `${String(query || "").trim().toLowerCase()}:${limit}`;
  const cached = WARM_CACHE.get(key);
  if (cached) return Promise.resolve(cached);
  const inflight = WARM_INFLIGHT.get(key);
  if (inflight) return inflight;
  const p = queryShopifyCatalog(query, limit, true)
    .then((res) => {
      if (res.length > 0) {
        WARM_CACHE.set(key, res);
        saveDiskCache();
      }
      return res;
    })
    .finally(() => {
      WARM_INFLIGHT.delete(key);
    });
  WARM_INFLIGHT.set(key, p);
  return p;
}
for (const q of PREWARM_QUERIES) {
  if (!WARM_CACHE.has(`${q}:1`)) {
    void fetchWithDedup(q, 1).catch(() => {});
  }
}

const TOOL_DEFINITION = {
  name: "search_catalog",
  description: "Search Shopify Global Catalog (AU/AUD). Returns {name,url,price_aud,store,audience,description,reason}.",
  annotations: {
    title: "Search Shopify Global Catalog",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      limit: { type: "number" },
      query: { type: "string" },
      view: { type: "string" },
    },
  },
};

function sendResponse(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.method === "initialize") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "shopify-global-catalog",
          version: "1.0.0",
        },
      },
    });
    return;
  }

  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") {
    return;
  }

  if (msg.method === "ping") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {},
    });
    return;
  }

  if (msg.method === "tools/list") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [TOOL_DEFINITION],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const args = msg.params?.arguments || {};
    const query = String(args.query || args.catalog?.query || "christmas gift").trim();
    const limit = args.limit ?? args.catalog?.pagination?.limit ?? 1;
    try {
      const products = await fetchWithDedup(query, limit);
      const payload = products.length === 1 ? products[0] : { query, products };
      sendResponse({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload),
            },
          ],
        },
      });
    } catch (err) {
      sendResponse({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err?.message || String(err) }),
            },
          ],
        },
      });
    }
    return;
  }

  if (msg.id !== undefined) {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      error: {
        code: -32601,
        message: `Method not found: ${msg.method}`,
      },
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    void handleMessage(msg);
  } catch {
    // ignore malformed input
  }
});
