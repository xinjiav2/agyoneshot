#!/usr/bin/env node
import readline from "node:readline";

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
    });
  }

  if (items.length === 0 && withShipsToFilter) {
    return queryShopifyCatalog(query, limit, false);
  }

  return items;
}

const TOOL_DEFINITION = {
  name: "search_catalog",
  description: "Search live Shopify Global Catalog (AU/AUD). Returns real product {name,url,price_aud,store}.",
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
      const products = await queryShopifyCatalog(query, limit, true);
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
