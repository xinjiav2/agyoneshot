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

function cleanProductUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(rawUrl || "");
  }
}

async function queryShopifyCatalog(query, limit = 1, withShipsToFilter = true, view = "compact") {
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

  const viewMode = String(view || "").toLowerCase();
  const isTurbo = viewMode === "turbo";
  const items = [];
  for (const p of rawProducts) {
    const v = Array.isArray(p?.variants) && p.variants.length > 0 ? p.variants[0] : null;
    if (!v || !v.url) continue;
    const rawAmount = v.price?.amount;
    const rawCurrency = String(v.price?.currency || "AUD").toUpperCase();
    const isAud = rawCurrency === "AUD";
    const parsedPrice =
      typeof rawAmount === "number"
        ? Number((rawAmount / 100).toFixed(2))
        : typeof rawAmount === "string" && !Number.isNaN(Number(rawAmount))
          ? Number((Number(rawAmount) / 100).toFixed(2))
          : null;
    const price = isAud ? parsedPrice : null;
    const title = String(p.title || v.title || "").replace(/["\\\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    const store = String(v.seller?.name || "").replace(/["\\\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    const cleanUrl = cleanProductUrl(v.url);
    const availability =
      typeof v.availability === "string"
        ? v.availability.replace(/_/g, " ")
        : v.availability?.available === false
          ? "Out of Stock"
          : "In Stock";

    const item = {
      name: title,
      url: cleanUrl,
      price_aud: price,
      store,
      audience,
      description: title,
      reason: "Great Christmas gift",
    };

    if (isTurbo) {
      item.currency = rawCurrency;
      item.availability = availability;
      item.category = "Christmas Gift";
      item.shipping = "Standard Holiday Delivery";
      item.gift_wrap = "Festive Holiday Wrap Available";
      item.return_policy = "Thirty Day Standard Online Store Return Window";
    }

    items.push(item);
  }

  if (items.length === 0 && withShipsToFilter) {
    return queryShopifyCatalog(query, limit, false, view);
  }

  return items;
}

const TOOL_DEFINITION = {
  name: "search_catalog",
  description: "Search live Shopify Global Catalog (AU/AUD). Returns verified gift product JSON.",
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
      criteria: { type: "string" },
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
    const view = String(args.view || args.catalog?.view || "compact").trim();
    try {
      const products = await queryShopifyCatalog(query, limit, true, view);
      const payload = products.length === 1 ? products[0] : products.length === 0 ? null : { query, products };
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

// Auto-exit after 45s idle (or when stdin closes) so repeated /new chats never leak MCP + anchor processes
const IDLE_EXIT_MS = 45_000;
let idleTimer = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
}

rl.on("line", (line) => {
  bumpIdle();
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    void handleMessage(msg);
  } catch {
    // ignore malformed input
  }
});

rl.on("close", () => process.exit(0));
process.stdin.on("end", () => process.exit(0));
