import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_INDEX_PATH = path.join(__dirname, 'public', 'index.html');
const REPLAY_DIR = path.join(__dirname, 'replays');
const REPLAY_FILE = path.join(REPLAY_DIR, 'latest.json');
const RUNS_LOG_FILE = path.join(__dirname, 'runs.jsonl');
const ENV_FILE = path.join(__dirname, '.env');

// Fallback .env loader if server.js is launched without --env-file=.env
function loadDotEnvFallback() {
  if (!fs.existsSync(ENV_FILE)) return;
  try {
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore fallback read errors
  }
}

loadDotEnvFallback();

function getConfig() {
  return {
    cerebrasApiKey: (process.env.CEREBRAS_API_KEY || '').trim(),
    cerebrasBaseUrl: (process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1').trim().replace(/\/+$/, ''),
    cerebrasModel: (process.env.CEREBRAS_MODEL || '').trim(),
    gpuApiKey: (process.env.GPU_API_KEY || '').trim(),
    gpuBaseUrl: (process.env.GPU_BASE_URL || 'https://api.moonshot.ai/v1').trim().replace(/\/+$/, ''),
    gpuModel: (process.env.GPU_MODEL || 'kimi-k3.1-pro').trim(),
    gpuLabel: (process.env.GPU_LABEL || 'Kimi API (GPU)').trim(),
    mock: process.env.MOCK === '1' || process.env.MOCK === 'true',
    port: Number(process.env.PORT) || 3000
  };
}

const SHOPIFY_MCP_URL = 'https://catalog.shopify.com/api/ucp/mcp';
const SHOPIFY_PROFILE_URL = 'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';
const SHOPIFY_CATEGORIES = ['kids toy', 'teen desk', 'candle', 'blanket', 'pet toy'];

const AUDIENCE_MAP = {
  'kids toy': 'kids',
  'teen desk': 'teens',
  'candle': 'adults',
  'blanket': 'grandparents',
  'pet toy': 'pets'
};

// Exact system prompt from specification
const SYSTEM_PROMPT = `你是极速圣诞选品代理。输入是5个类目的Shopify搜索结果（JSON）。
每类选1件最适合送礼的商品，只用输入数据，严禁编造：
name=title；url原样复制；store=store；price_aud=price（已是元，两位小数），currency不是AUD则填null；
audience固定：kids toy→kids，teen desk→teens，candle→adults，blanket→grandparents，pet toy→pets；
description≤8字，reason≤5字；某类无结果则该位置为null。
零废话、无推理、无Markdown，只输出单行JSON：
{"gifts":[{"name":"","url":"","price_aud":0.00,"store":"","audience":"","description":"","reason":""}]}`;

let cachedMcpSessionId = null;
let mcpInitPromise = null;

function parseJsonOrSseResponse(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to SSE parsing
    }
  }

  let lastParsed = null;
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      lastParsed = obj;
      if (obj?.result || obj?.error) {
        return obj;
      }
    } catch {
      // Ignore malformed SSE lines
    }
  }
  return lastParsed;
}

async function ensureMcpInitialized() {
  if (cachedMcpSessionId) return cachedMcpSessionId;
  if (mcpInitPromise) return mcpInitPromise;

  mcpInitPromise = (async () => {
    try {
      const res = await fetch(SHOPIFY_MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'kimi-speed-race', version: '1.0.0' }
          }
        })
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) cachedMcpSessionId = sid;
      return cachedMcpSessionId;
    } catch {
      return null;
    } finally {
      mcpInitPromise = null;
    }
  })();

  return mcpInitPromise;
}

async function callShopifySearch(query, includeShipsToFilter = true, allowHandshakeRetry = true) {
  const catalogArgs = {
    query,
    view: 'compact',
    pagination: { limit: 2 },
    context: { address_country: 'AU', currency: 'AUD' }
  };
  if (includeShipsToFilter) {
    catalogArgs.filters = { ships_to: { country: 'AU' } };
  }

  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        meta: {
          'ucp-agent': {
            profile: SHOPIFY_PROFILE_URL
          }
        },
        catalog: catalogArgs
      }
    }
  };

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };
  if (cachedMcpSessionId) {
    headers['Mcp-Session-Id'] = cachedMcpSessionId;
  }

  const res = await fetch(SHOPIFY_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(rpcBody),
    signal: AbortSignal.timeout(15000)
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) cachedMcpSessionId = sid;

  const rawText = await res.text();
  const parsed = parseJsonOrSseResponse(rawText);

  const needsInit =
    (!res.ok || parsed?.error) &&
    allowHandshakeRetry &&
    /initialize|session/i.test(rawText);

  if (needsInit) {
    await ensureMcpInitialized();
    return callShopifySearch(query, includeShipsToFilter, false);
  }

  let products = parsed?.result?.structuredContent?.products;
  if (!Array.isArray(products) && Array.isArray(parsed?.result?.content)) {
    for (const part of parsed.result.content) {
      if (typeof part?.text === 'string') {
        try {
          const inner = JSON.parse(part.text);
          if (Array.isArray(inner?.products)) {
            products = inner.products;
            break;
          }
          if (Array.isArray(inner?.structuredContent?.products)) {
            products = inner.structuredContent.products;
            break;
          }
        } catch {
          // Ignore non-JSON text content
        }
      }
    }
  }

  if (!Array.isArray(products)) {
    products = [];
  }

  const items = [];
  for (const product of products) {
    const firstVariant = Array.isArray(product?.variants) && product.variants.length > 0
      ? product.variants[0]
      : null;
    if (!firstVariant || !firstVariant.url) continue;

    const rawAmount = firstVariant.price?.amount;
    const price = typeof rawAmount === 'number'
      ? Number((rawAmount / 100).toFixed(2))
      : (typeof rawAmount === 'string' && !Number.isNaN(Number(rawAmount))
        ? Number((Number(rawAmount) / 100).toFixed(2))
        : null);

    items.push({
      title: String(product.title || firstVariant.title || '').trim(),
      url: String(firstVariant.url),
      store: String(firstVariant.seller?.name || '').trim(),
      price,
      currency: String(firstVariant.price?.currency || '').trim()
    });
  }

  return items;
}

async function searchSingleCategory(category) {
  let retriedWithoutFilter = false;
  let items = await callShopifySearch(category, true);
  if (items.length === 0) {
    retriedWithoutFilter = true;
    items = await callShopifySearch(category, false);
  }
  return {
    category,
    items,
    retriedWithoutFilter
  };
}

function getFallbackCatalog() {
  return [
    {
      category: 'kids toy',
      items: [
        {
          title: 'Magnetic RoboCar Set',
          url: 'https://smartoonkids.com/products/magnetic-robocar-set?variant=44703613092029&_gsid=XYRCeXywWqur&utm_source=shopify&utm_medium=catalog',
          store: 'Smartoon Kids',
          price: 100,
          currency: 'AUD'
        },
        {
          title: 'Montessori Activity Toy for Kids – Educational Game to Support Motor Skills, Understanding & Creativity',
          url: 'https://kidsaustralia.com/products/montessori-activity-toy-for-kids-educational-game-to-support-motor-skills-understanding-creativity?variant=61741858128202&_gsid=XYRCeXywWqur&utm_source=shopify&utm_medium=catalog',
          store: 'Kids Australia',
          price: 31.95,
          currency: 'AUD'
        }
      ]
    },
    {
      category: 'teen desk',
      items: [
        {
          title: 'Layla Study Desk',
          url: 'https://www.hipkids.com.au/products/layla-study-desk?variant=40291465887878&_gsid=dXU9BmGQmcbj&utm_source=shopify&utm_medium=catalog',
          store: 'HipKids',
          price: 219.99,
          currency: 'AUD'
        },
        {
          title: 'Child Craft Harmony Desk - Dusty Heather',
          url: 'https://www.canabeebaby.com/products/child-craft-harmony-desk-dusty-heather-f09017-86?variant=43247782723702&_gsid=dXU9BmGQmcbj&utm_source=shopify&utm_medium=catalog',
          store: 'CanaBee Baby',
          price: 183,
          currency: 'AUD'
        }
      ]
    },
    {
      category: 'candle',
      items: [
        {
          title: 'Magnolia Gathered Candle',
          url: 'https://magnolia.com/products/gathered-candle-new?variant=39444532854835&_gsid=7VxoD1VQc7qy&utm_source=shopify&utm_medium=catalog',
          store: 'Magnolia',
          price: 30,
          currency: 'USD'
        },
        {
          title: 'JUST BREATHE  Soy Wax Candle 8 oz',
          url: 'https://thescentedmarket.ca/products/just-breathe?variant=13032091648113&_gsid=7VxoD1VQc7qy&utm_source=shopify&utm_medium=catalog',
          store: 'The Scented Market',
          price: 23,
          currency: 'AUD'
        }
      ]
    },
    {
      category: 'blanket',
      items: [
        {
          title: 'Dreamer Blanket',
          url: 'https://comfrt.com/products/the-dreamer-blanket?_gsid=5E1ABncZAnUB&utm_source=shopify&utm_medium=catalog',
          store: 'Comfrt',
          price: 221,
          currency: 'AUD'
        },
        {
          title: 'Original Stretch™ Blanket',
          url: 'https://bigblanket.com/products/the-big-blanket?variant=27926196715584&_gsid=5E1ABncZAnUB&utm_source=shopify&utm_medium=catalog',
          store: 'Big Blanket Co',
          price: 249,
          currency: 'AUD'
        }
      ]
    },
    {
      category: 'pet toy',
      items: [
        {
          title: 'Jw Pet Dog Toy Hol-ee Roller Ball Small',
          url: 'https://nrsworld.com/products/jw-dog-toy-hol-ee-roller-ball-small?variant=39448765104267&_gsid=ReuYo4GKb6me&utm_source=shopify&utm_medium=catalog',
          store: 'NRS',
          price: 10.95,
          currency: 'USD'
        },
        {
          title: 'Dog ball on rope',
          url: 'https://www.nonstopdogwear.com/products/dog-ball-on-rope?variant=46537885319417&_gsid=ReuYo4GKb6me&utm_source=shopify&utm_medium=catalog',
          store: 'Non-stop dogwear',
          price: 13.99,
          currency: 'USD'
        }
      ]
    }
  ];
}

async function runShopifyStep() {
  const start = performance.now();
  let details;
  let usedFallback = false;
  try {
    details = await Promise.all(SHOPIFY_CATEGORIES.map(cat => searchSingleCategory(cat)));
  } catch {
    usedFallback = true;
    details = getFallbackCatalog().map(c => ({ ...c, retriedWithoutFilter: false }));
  }

  const ms = Math.max(1, Math.round(performance.now() - start));
  const slimCatalog = details.map(({ category, items }) => ({ category, items }));
  const catalogUrls = new Set();
  let totalItems = 0;

  for (const cat of slimCatalog) {
    for (const item of cat.items) {
      totalItems += 1;
      if (item.url) catalogUrls.add(item.url);
    }
  }

  return {
    ms,
    totalItems,
    usedFallback,
    counts: details.map(d => ({
      category: d.category,
      count: d.items.length,
      retriedWithoutFilter: Boolean(d.retriedWithoutFilter)
    })),
    slimCatalog,
    catalogUrls
  };
}

function extractRateLimitHeaders(headers) {
  const out = {};
  if (!headers || typeof headers.forEach !== 'function') return out;
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith('x-ratelimit-') || lower.startsWith('ratelimit-') || lower === 'retry-after') {
      out[lower] = value;
    }
  });
  return out;
}

function parseRetryAfterMs(headers, retryIndex) {
  const fallbackMs = [2000, 4000, 8000][Math.min(retryIndex, 2)] || 8000;
  if (!headers || typeof headers.get !== 'function') return fallbackMs;
  const raw = headers.get('retry-after');
  if (!raw) return fallbackMs;
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) {
    return Math.min(60000, Math.max(250, Math.round(num * 1000)));
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    if (diff > 0) return Math.min(60000, diff);
  }
  return fallbackMs;
}

function stripCodeFences(rawText) {
  let cleaned = (rawText || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return cleaned;
}

function parseAndVerifyGifts(rawText, catalogUrls) {
  const cleaned = stripCodeFences(rawText);
  if (!cleaned) {
    return { validJson: false, urlsVerified: false, gifts: [], parseError: 'Empty model output' };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (err) {
        return { validJson: false, urlsVerified: false, gifts: [], parseError: err.message };
      }
    } else {
      return { validJson: false, urlsVerified: false, gifts: [], parseError: 'Invalid JSON output' };
    }
  }

  if (!parsed || !Array.isArray(parsed.gifts)) {
    return { validJson: false, urlsVerified: false, gifts: [], parseError: 'Missing "gifts" array in JSON' };
  }

  let allVerified = true;
  let nonNullCount = 0;

  const gifts = parsed.gifts.map((gift, idx) => {
    const fallbackCategory = SHOPIFY_CATEGORIES[idx] || `category_${idx + 1}`;
    if (gift === null || typeof gift !== 'object') {
      return null;
    }
    nonNullCount += 1;
    const url = typeof gift.url === 'string' ? gift.url.trim() : '';
    const urlVerified = Boolean(url && catalogUrls.has(url));
    if (!urlVerified) {
      allVerified = false;
    }
    return {
      name: String(gift.name || '').trim(),
      url,
      price_aud: typeof gift.price_aud === 'number' ? Number(gift.price_aud.toFixed(2)) : null,
      store: String(gift.store || '').trim(),
      audience: String(gift.audience || AUDIENCE_MAP[fallbackCategory] || '').trim(),
      description: String(gift.description || '').trim(),
      reason: String(gift.reason || '').trim(),
      url_verified: urlVerified,
      url_status: urlVerified ? 'verified' : 'not from catalog'
    };
  });

  const urlsVerified = nonNullCount > 0 && allVerified;
  return {
    validJson: true,
    urlsVerified,
    gifts,
    parseError: null
  };
}

function appendRunLog(entry) {
  try {
    fs.appendFileSync(RUNS_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Non-fatal if disk write fails
  }
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizeErrorText(text, apiKey) {
  let out = String(text || '');
  if (apiKey && apiKey.length >= 4) {
    out = out.split(apiKey).join('[REDACTED]');
  }
  return out.slice(0, 350);
}

function buildMockOutputFromCatalog(slimCatalog) {
  const sampleMeta = {
    'kids toy': { description: '百变磁力拼装车', reason: '益智首选' },
    'teen desk': { description: '现代简约学习桌', reason: '专注成长' },
    'candle': { description: '大豆舒缓香薰蜡烛', reason: '温馨节日' },
    'blanket': { description: '云感柔顺保暖毯', reason: '冬日暖心' },
    'pet toy': { description: '耐咬镂空互动球', reason: '爱宠最爱' }
  };

  const gifts = slimCatalog.map(cat => {
    const items = Array.isArray(cat.items) ? cat.items : [];
    if (items.length === 0) return null;
    const preferred = items.find(i => i.currency === 'AUD') || items[0];
    const meta = sampleMeta[cat.category] || { description: '精选节日好礼', reason: '送礼佳品' };
    return {
      name: preferred.title,
      url: preferred.url,
      price_aud: preferred.currency === 'AUD' && typeof preferred.price === 'number'
        ? Number(preferred.price.toFixed(2))
        : null,
      store: preferred.store,
      audience: AUDIENCE_MAP[cat.category] || 'all',
      description: meta.description,
      reason: meta.reason
    };
  });

  return JSON.stringify({ gifts });
}

function splitIntoTokenChunks(str, chunkSize = 14) {
  const chunks = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.slice(i, i + chunkSize));
  }
  return chunks;
}

async function runMockLane({
  round,
  laneId,
  label,
  model,
  thinkingOn,
  slimCatalog,
  catalogUrls,
  emit,
  clientSignal
}) {
  const isCerebras = laneId === 'cerebras';
  const ttftTargetMs = isCerebras ? 155 : 1140;
  const stepDelayMs = isCerebras ? 22 : 145;
  const mockHeaders = isCerebras
    ? {
        'x-ratelimit-limit-requests-minute': '30',
        'x-ratelimit-remaining-requests-minute': '28',
        'x-ratelimit-remaining-tokens-minute': '58420'
      }
    : {
        'x-ratelimit-limit-requests': '60',
        'x-ratelimit-remaining-requests': '57'
      };

  const attemptStart = performance.now();
  emit('lane_start', {
    round,
    lane: laneId,
    label,
    model,
    retries: 0,
    waited_ms: 0,
    thinkingUnsupported: false
  });

  emit('lane_headers', {
    round,
    lane: laneId,
    headers: mockHeaders
  });

  await sleep(ttftTargetMs, clientSignal);
  if (clientSignal?.aborted) {
    return { lane: laneId, ok: false, aborted: true };
  }

  let ttftMs = null;
  let reasoningText = '';
  let contentText = '';

  if (thinkingOn) {
    const reasoningSample =
      '检查5个Shopify类目数据：1. kids toy选AUD计价商品；2. teen desk选HipKids学习桌；3. candle选AUD蜡烛（跳过USD项）；4. blanket选AUD毛毯；5. pet toy均为USD故price_aud填null。原样复制URL并输出单行JSON。\n';
    const rChunks = splitIntoTokenChunks(reasoningSample, 12);
    for (const chunk of rChunks) {
      if (clientSignal?.aborted) break;
      const nowElapsed = Math.max(1, Math.round(performance.now() - attemptStart));
      if (ttftMs === null) ttftMs = nowElapsed;
      reasoningText += chunk;
      emit('lane_delta', {
        round,
        lane: laneId,
        kind: 'reasoning',
        text: chunk,
        ttft_ms: ttftMs,
        elapsed_ms: nowElapsed
      });
      await sleep(stepDelayMs, clientSignal);
    }
  }

  const targetJson = buildMockOutputFromCatalog(slimCatalog);
  const cChunks = splitIntoTokenChunks(targetJson, 16);
  for (const chunk of cChunks) {
    if (clientSignal?.aborted) break;
    const nowElapsed = Math.max(1, Math.round(performance.now() - attemptStart));
    if (ttftMs === null) ttftMs = nowElapsed;
    contentText += chunk;
    emit('lane_delta', {
      round,
      lane: laneId,
      kind: 'content',
      text: chunk,
      ttft_ms: ttftMs,
      elapsed_ms: nowElapsed
    });
    await sleep(stepDelayMs, clientSignal);
  }

  const totalMs = Math.max(1, Math.round(performance.now() - attemptStart));
  if (ttftMs === null) ttftMs = totalMs;

  const reasoningTokens = reasoningText.length > 0 ? Math.max(1, Math.ceil(reasoningText.length / 3.2)) : 0;
  const contentTokens = Math.max(1, Math.ceil(contentText.length / 3.5));
  const tokens = contentTokens + reasoningTokens;
  const tokS = Number((tokens / (totalMs / 1000)).toFixed(1));

  const parsed = parseAndVerifyGifts(contentText, catalogUrls);

  appendRunLog({
    timestamp: new Date().toISOString(),
    lane: laneId,
    model,
    thinking: thinkingOn ? 'on' : 'off',
    ttft_ms: ttftMs,
    total_ms: totalMs,
    tokens,
    tok_s: tokS,
    valid_json: parsed.validJson,
    urls_verified: parsed.urlsVerified,
    retries: 0,
    waited_ms: 0
  });

  const resultPayload = {
    round,
    lane: laneId,
    label,
    model,
    ok: true,
    ttft_ms: ttftMs,
    total_ms: totalMs,
    tokens,
    reasoning_tokens: reasoningTokens,
    tokens_estimated: false,
    tok_s: tokS,
    valid_json: parsed.validJson,
    urls_verified: parsed.urlsVerified,
    gifts: parsed.gifts,
    raw_text: contentText,
    reasoning_text: reasoningText,
    retries: 0,
    waited_ms: 0,
    thinkingUnsupported: false,
    headers: mockHeaders
  };

  emit('lane_done', resultPayload);
  return resultPayload;
}

async function runLiveLane({
  round,
  laneId,
  label,
  baseUrl,
  apiKey,
  model,
  thinkingOn,
  userMessageJson,
  catalogUrls,
  emit,
  clientSignal
}) {
  if (!apiKey || !model) {
    const missingItems = [];
    if (!apiKey) missingItems.push(laneId === 'cerebras' ? 'CEREBRAS_API_KEY' : 'GPU_API_KEY');
    if (!model) missingItems.push(laneId === 'cerebras' ? 'CEREBRAS_MODEL' : 'GPU_MODEL');
    const errMsg = `Missing ${missingItems.join(' and ')} in .env`;

    emit('lane_start', {
      round,
      lane: laneId,
      label,
      model: model || '(not configured)',
      retries: 0,
      waited_ms: 0,
      thinkingUnsupported: false
    });

    emit('lane_error', {
      round,
      lane: laneId,
      label,
      model: model || '(not configured)',
      rateLimited: false,
      retries: 0,
      waited_ms: 0,
      headers: {},
      error: errMsg
    });

    appendRunLog({
      timestamp: new Date().toISOString(),
      lane: laneId,
      model: model || '',
      thinking: thinkingOn ? 'on' : 'off',
      ttft_ms: null,
      total_ms: 0,
      tokens: 0,
      tok_s: 0,
      valid_json: false,
      urls_verified: false,
      retries: 0,
      waited_ms: 0
    });

    return {
      lane: laneId,
      ok: false,
      rateLimited: false,
      error: errMsg,
      retries: 0,
      waited_ms: 0
    };
  }

  let retries = 0;
  let waitedMs = 0;
  let includeThinkingField = !thinkingOn;
  let thinkingUnsupported = false;
  let latestHeaders = {};

  while (true) {
    if (clientSignal?.aborted) {
      return { lane: laneId, ok: false, aborted: true };
    }

    const attemptController = new AbortController();
    const timeoutId = setTimeout(() => attemptController.abort(new Error('Timeout after 120s')), 120000);
    const onClientAbort = () => attemptController.abort(new Error('Client disconnected'));
    if (clientSignal) clientSignal.addEventListener('abort', onClientAbort, { once: true });

    const attemptStart = performance.now();
    emit('lane_start', {
      round,
      lane: laneId,
      label,
      model,
      retries,
      waited_ms: waitedMs,
      thinkingUnsupported
    });

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessageJson }
      ],
      temperature: 0,
      max_tokens: thinkingOn ? 4000 : 800,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (!thinkingOn && includeThinkingField) {
      requestBody.thinking = { type: 'disabled' };
    }

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: attemptController.signal
      });

      const rlHeaders = extractRateLimitHeaders(res.headers);
      if (Object.keys(rlHeaders).length > 0) {
        latestHeaders = { ...latestHeaders, ...rlHeaders };
        emit('lane_headers', {
          round,
          lane: laneId,
          headers: latestHeaders
        });
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');

        // If 400 when thinking={"type":"disabled"} was sent, retry once without it
        if (res.status === 400 && !thinkingOn && includeThinkingField) {
          includeThinkingField = false;
          thinkingUnsupported = true;
          emit('lane_notice', {
            round,
            lane: laneId,
            notice: 'thinking setting not supported'
          });
          continue;
        }

        const isRateLimit =
          res.status === 429 ||
          /rate[_ -]?limit|too[_ -]?many[_ -]?requests/i.test(errBody);

        if (isRateLimit) {
          if (retries < 3) {
            const waitMs = parseRetryAfterMs(res.headers, retries);
            retries += 1;
            waitedMs += waitMs;
            emit('lane_retry', {
              round,
              lane: laneId,
              retries,
              wait_ms: waitMs,
              waited_ms: waitedMs,
              headers: latestHeaders,
              message: `rate-limited, retrying ${retries}× (waiting ${(waitMs / 1000).toFixed(1).replace(/\.0$/, '')} s)`
            });
            await sleep(waitMs, clientSignal);
            continue;
          } else {
            const waitedSec = (waitedMs / 1000).toFixed(1).replace(/\.0$/, '');
            const msg = `rate-limited, retried ${retries}× (waited ${waitedSec} s)`;
            emit('lane_error', {
              round,
              lane: laneId,
              label,
              model,
              rateLimited: true,
              retries,
              waited_ms: waitedMs,
              headers: latestHeaders,
              error: msg
            });
            appendRunLog({
              timestamp: new Date().toISOString(),
              lane: laneId,
              model,
              thinking: thinkingOn ? 'on' : 'off',
              ttft_ms: null,
              total_ms: 0,
              tokens: 0,
              tok_s: 0,
              valid_json: false,
              urls_verified: false,
              retries,
              waited_ms: waitedMs
            });
            return {
              lane: laneId,
              ok: false,
              rateLimited: true,
              retries,
              waited_ms: waitedMs,
              headers: latestHeaders,
              error: msg
            };
          }
        }

        const cleanErr = sanitizeErrorText(errBody || res.statusText, apiKey);
        const errMessage = `HTTP ${res.status}: ${cleanErr}`;
        emit('lane_error', {
          round,
          lane: laneId,
          label,
          model,
          rateLimited: false,
          status: res.status,
          retries,
          waited_ms: waitedMs,
          headers: latestHeaders,
          error: errMessage
        });
        appendRunLog({
          timestamp: new Date().toISOString(),
          lane: laneId,
          model,
          thinking: thinkingOn ? 'on' : 'off',
          ttft_ms: null,
          total_ms: Math.round(performance.now() - attemptStart),
          tokens: 0,
          tok_s: 0,
          valid_json: false,
          urls_verified: false,
          retries,
          waited_ms: waitedMs
        });
        return {
          lane: laneId,
          ok: false,
          rateLimited: false,
          retries,
          waited_ms: waitedMs,
          headers: latestHeaders,
          error: errMessage
        };
      }

      // Stream SSE response body
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ttftMs = null;
      let contentText = '';
      let reasoningText = '';
      let reasoningChunks = 0;
      let usage = null;
      let streamRateLimitError = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const rawLine = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          let chunk;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (chunk?.error) {
            const errStr = JSON.stringify(chunk.error);
            if (/rate[_ -]?limit|429|too[_ -]?many/i.test(errStr)) {
              streamRateLimitError = chunk.error?.message || errStr;
              break;
            }
          }

          if (chunk?.usage) {
            usage = chunk.usage;
          }

          const choice = chunk?.choices?.[0];
          const delta = choice?.delta || {};
          const rDelta = delta.reasoning_content ?? delta.reasoning ?? '';
          const cDelta = delta.content ?? '';

          if ((rDelta || cDelta) && ttftMs === null) {
            ttftMs = Math.max(1, Math.round(performance.now() - attemptStart));
          }

          if (rDelta) {
            reasoningText += rDelta;
            reasoningChunks += 1;
            emit('lane_delta', {
              round,
              lane: laneId,
              kind: 'reasoning',
              text: rDelta,
              ttft_ms: ttftMs,
              elapsed_ms: Math.max(1, Math.round(performance.now() - attemptStart))
            });
          }

          if (cDelta) {
            contentText += cDelta;
            emit('lane_delta', {
              round,
              lane: laneId,
              kind: 'content',
              text: cDelta,
              ttft_ms: ttftMs,
              elapsed_ms: Math.max(1, Math.round(performance.now() - attemptStart))
            });
          }
        }

        if (streamRateLimitError) break;
      }

      if (streamRateLimitError) {
        if (retries < 3) {
          const waitMs = parseRetryAfterMs(res.headers, retries);
          retries += 1;
          waitedMs += waitMs;
          emit('lane_retry', {
            round,
            lane: laneId,
            retries,
            wait_ms: waitMs,
            waited_ms: waitedMs,
            headers: latestHeaders,
            message: `rate-limited, retrying ${retries}× (waiting ${(waitMs / 1000).toFixed(1).replace(/\.0$/, '')} s)`
          });
          await sleep(waitMs, clientSignal);
          continue;
        } else {
          const waitedSec = (waitedMs / 1000).toFixed(1).replace(/\.0$/, '');
          const msg = `rate-limited, retried ${retries}× (waited ${waitedSec} s)`;
          emit('lane_error', {
            round,
            lane: laneId,
            label,
            model,
            rateLimited: true,
            retries,
            waited_ms: waitedMs,
            headers: latestHeaders,
            error: msg
          });
          appendRunLog({
            timestamp: new Date().toISOString(),
            lane: laneId,
            model,
            thinking: thinkingOn ? 'on' : 'off',
            ttft_ms: null,
            total_ms: 0,
            tokens: 0,
            tok_s: 0,
            valid_json: false,
            urls_verified: false,
            retries,
            waited_ms: waitedMs
          });
          return {
            lane: laneId,
            ok: false,
            rateLimited: true,
            retries,
            waited_ms: waitedMs,
            headers: latestHeaders,
            error: msg
          };
        }
      }

      const totalMs = Math.max(1, Math.round(performance.now() - attemptStart));
      if (ttftMs === null) ttftMs = totalMs;

      const estReasoningTokens = reasoningText.length > 0
        ? Math.max(reasoningChunks, Math.ceil(reasoningText.length / 3.5))
        : 0;
      const estContentTokens = contentText.length > 0
        ? Math.max(1, Math.ceil(contentText.length / 3.5))
        : 0;

      const apiReasoningTokens =
        usage?.completion_tokens_details?.reasoning_tokens ??
        usage?.reasoning_tokens ??
        null;

      const reasoningTokens = reasoningText.length > 0
        ? (typeof apiReasoningTokens === 'number' ? apiReasoningTokens : estReasoningTokens)
        : 0;

      const hasUsageCompletion = typeof usage?.completion_tokens === 'number' && usage.completion_tokens > 0;
      const tokens = hasUsageCompletion
        ? usage.completion_tokens
        : Math.max(1, estContentTokens + reasoningTokens);
      const tokensEstimated = !hasUsageCompletion;
      const tokS = Number((tokens / (totalMs / 1000)).toFixed(1));

      const parsed = parseAndVerifyGifts(contentText, catalogUrls);

      appendRunLog({
        timestamp: new Date().toISOString(),
        lane: laneId,
        model,
        thinking: thinkingOn ? 'on' : 'off',
        ttft_ms: ttftMs,
        total_ms: totalMs,
        tokens,
        tok_s: tokS,
        valid_json: parsed.validJson,
        urls_verified: parsed.urlsVerified,
        retries,
        waited_ms: waitedMs
      });

      const donePayload = {
        round,
        lane: laneId,
        label,
        model,
        ok: true,
        ttft_ms: ttftMs,
        total_ms: totalMs,
        tokens,
        reasoning_tokens: reasoningTokens,
        tokens_estimated: tokensEstimated,
        tok_s: tokS,
        valid_json: parsed.validJson,
        urls_verified: parsed.urlsVerified,
        gifts: parsed.gifts,
        raw_text: contentText,
        reasoning_text: reasoningText,
        retries,
        waited_ms: waitedMs,
        thinkingUnsupported,
        headers: latestHeaders
      };

      emit('lane_done', donePayload);
      return donePayload;
    } catch (err) {
      const cleanErr = sanitizeErrorText(err?.message || String(err), apiKey);
      emit('lane_error', {
        round,
        lane: laneId,
        label,
        model,
        rateLimited: false,
        retries,
        waited_ms: waitedMs,
        headers: latestHeaders,
        error: cleanErr
      });
      appendRunLog({
        timestamp: new Date().toISOString(),
        lane: laneId,
        model,
        thinking: thinkingOn ? 'on' : 'off',
        ttft_ms: null,
        total_ms: Math.round(performance.now() - attemptStart),
        tokens: 0,
        tok_s: 0,
        valid_json: false,
        urls_verified: false,
        retries,
        waited_ms: waitedMs
      });
      return {
        lane: laneId,
        ok: false,
        rateLimited: false,
        retries,
        waited_ms: waitedMs,
        headers: latestHeaders,
        error: cleanErr
      };
    } finally {
      clearTimeout(timeoutId);
      if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
    }
  }
}

function getReplayMetadata() {
  if (!fs.existsSync(REPLAY_FILE)) {
    return { exists: false, savedAt: null };
  }
  try {
    const raw = fs.readFileSync(REPLAY_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.events) && data.events.length > 0) {
      return { exists: true, savedAt: data.savedAt || null };
    }
  } catch {
    // Ignore malformed replay file
  }
  return { exists: false, savedAt: null };
}

function saveReplayTimeline(replayData) {
  try {
    fs.mkdirSync(REPLAY_DIR, { recursive: true });
    fs.writeFileSync(REPLAY_FILE, `${JSON.stringify(replayData, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function handleReplayStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientController = new AbortController();
  req.on('close', () => clientController.abort());

  function writeSse(event, data) {
    if (clientController.signal.aborted || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  if (!fs.existsSync(REPLAY_FILE)) {
    writeSse('race_error', { error: 'No saved replay exists in replays/latest.json' });
    res.end();
    return;
  }

  let replay;
  try {
    replay = JSON.parse(fs.readFileSync(REPLAY_FILE, 'utf8'));
  } catch (err) {
    writeSse('race_error', { error: `Failed to read replay file: ${err.message}` });
    res.end();
    return;
  }

  const events = Array.isArray(replay?.events) ? replay.events : [];
  let prevT = 0;

  for (const item of events) {
    if (clientController.signal.aborted) break;
    const t = typeof item.t === 'number' && item.t >= prevT ? item.t : prevT;
    const delay = t - prevT;
    if (delay > 0) {
      await sleep(delay, clientController.signal);
    }
    prevT = t;
    if (clientController.signal.aborted) break;

    if (item.event === 'meta') {
      writeSse('meta', {
        ...item.data,
        mode: 'replay',
        savedAt: replay.savedAt || item.data?.startedAt || 'unknown time'
      });
    } else if (item.event === 'summary') {
      writeSse('summary', {
        ...item.data,
        mode: 'replay',
        savedAt: replay.savedAt || 'unknown time'
      });
    } else {
      writeSse(item.event, item.data);
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
}

async function handleRaceStream(req, res, searchParams) {
  if (searchParams.get('replay') === '1' || searchParams.get('replay') === 'true') {
    await handleReplayStream(req, res);
    return;
  }

  const config = getConfig();
  const isMock = config.mock || searchParams.get('mock') === '1';
  const thinkingParam = (searchParams.get('thinking') || 'off').toLowerCase();
  const thinkingOn = thinkingParam === 'on' || thinkingParam === 'true' || thinkingParam === '1';
  const rawRounds = parseInt(searchParams.get('rounds') || '1', 10);
  const rounds = Number.isNaN(rawRounds) ? 1 : Math.min(10, Math.max(1, rawRounds));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientController = new AbortController();
  req.on('close', () => clientController.abort());

  const raceStart = performance.now();
  const timelineEvents = [];

  function emit(event, data) {
    if (clientController.signal.aborted || res.writableEnded) return;
    const t = Math.max(0, Math.round(performance.now() - raceStart));
    timelineEvents.push({ t, event, data });
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const cerebrasModelDisplay = config.cerebrasModel || (isMock ? 'kimi-k3.1-pro' : '');
  const gpuModelDisplay = config.gpuModel || 'kimi-k3.1-pro';
  const startedAt = new Date().toISOString();

  emit('meta', {
    mode: isMock ? 'mock' : 'live',
    thinking: thinkingOn ? 'on' : 'off',
    rounds,
    startedAt,
    models: {
      cerebras: cerebrasModelDisplay || '(unset)',
      gpu: gpuModelDisplay
    },
    labels: {
      cerebras: 'Cerebras',
      gpu: config.gpuLabel || 'Kimi API (GPU)'
    }
  });

  // Step 1: 5 parallel Shopify Global Catalog searches (shared across both lanes and all rounds)
  emit('shopify_start', { categories: SHOPIFY_CATEGORIES });
  const shopifyStep = await runShopifyStep();

  emit('shopify', {
    ms: shopifyStep.ms,
    totalItems: shopifyStep.totalItems,
    usedFallback: shopifyStep.usedFallback,
    counts: shopifyStep.counts,
    catalog: shopifyStep.slimCatalog
  });

  const userMessageJson = JSON.stringify(shopifyStep.slimCatalog);
  const roundResults = [];

  for (let round = 1; round <= rounds; round++) {
    if (clientController.signal.aborted) break;

    emit('round_start', { round, rounds });

    const laneRunner = isMock ? runMockLane : runLiveLane;

    // Launch both lanes at the exact same moment
    const [cerebrasRes, gpuRes] = await Promise.all([
      laneRunner({
        round,
        laneId: 'cerebras',
        label: 'Cerebras',
        baseUrl: config.cerebrasBaseUrl,
        apiKey: config.cerebrasApiKey,
        model: cerebrasModelDisplay,
        thinkingOn,
        userMessageJson,
        slimCatalog: shopifyStep.slimCatalog,
        catalogUrls: shopifyStep.catalogUrls,
        emit,
        clientSignal: clientController.signal
      }),
      laneRunner({
        round,
        laneId: 'gpu',
        label: config.gpuLabel || 'Kimi API (GPU)',
        baseUrl: config.gpuBaseUrl,
        apiKey: config.gpuApiKey,
        model: gpuModelDisplay,
        thinkingOn,
        userMessageJson,
        slimCatalog: shopifyStep.slimCatalog,
        catalogUrls: shopifyStep.catalogUrls,
        emit,
        clientSignal: clientController.signal
      })
    ]);

    const bothSucceeded = Boolean(cerebrasRes?.ok && gpuRes?.ok && !cerebrasRes?.rateLimited && !gpuRes?.rateLimited);
    let speedup = null;
    let banner = '';
    let skippedRatio = false;

    if (bothSucceeded && cerebrasRes.total_ms > 0) {
      speedup = Number((gpuRes.total_ms / cerebrasRes.total_ms).toFixed(1));
      const cSec = (cerebrasRes.total_ms / 1000).toFixed(1);
      const gSec = (gpuRes.total_ms / 1000).toFixed(1);
      banner = `Cerebras was ${speedup}× faster (${cSec} s vs ${gSec} s)`;
    } else {
      skippedRatio = true;
      if (cerebrasRes?.rateLimited || gpuRes?.rateLimited) {
        banner = 'Rate-limited after 3 retries — speed ratio skipped for this round';
      } else {
        banner = 'Speed ratio unavailable (one or both lanes did not complete)';
      }
    }

    const roundSummary = {
      round,
      rounds,
      bothSucceeded,
      skippedRatio,
      speedup,
      banner,
      cerebras: cerebrasRes,
      gpu: gpuRes
    };

    roundResults.push(roundSummary);
    emit('round_done', roundSummary);
  }

  const validRounds = roundResults.filter(r => r.bothSucceeded);
  const cSuccessRounds = roundResults.filter(r => r.cerebras?.ok);
  const gSuccessRounds = roundResults.filter(r => r.gpu?.ok);

  const avg = (arr, fn) => (arr.length > 0 ? arr.reduce((acc, x) => acc + fn(x), 0) / arr.length : null);

  const avgCerebrasMs = avg(cSuccessRounds, r => r.cerebras.total_ms);
  const avgGpuMs = avg(gSuccessRounds, r => r.gpu.total_ms);
  const avgCerebrasTtft = avg(cSuccessRounds, r => r.cerebras.ttft_ms);
  const avgGpuTtft = avg(gSuccessRounds, r => r.gpu.ttft_ms);
  const avgCerebrasTokS = avg(cSuccessRounds, r => r.cerebras.tok_s);
  const avgGpuTokS = avg(gSuccessRounds, r => r.gpu.tok_s);

  const avgSpeedup =
    validRounds.length > 0 && avgCerebrasMs > 0 && avgGpuMs > 0
      ? Number((avgGpuMs / avgCerebrasMs).toFixed(1))
      : null;

  let savedReplay = false;
  const savedAt = new Date().toISOString();

  const summaryPayload = {
    mode: isMock ? 'mock' : 'live',
    thinking: thinkingOn ? 'on' : 'off',
    rounds,
    completedRounds: roundResults.length,
    validComparisonRounds: validRounds.length,
    shopify_ms: shopifyStep.ms,
    averages: {
      speedup: avgSpeedup,
      cerebras_total_ms: avgCerebrasMs ? Math.round(avgCerebrasMs) : null,
      gpu_total_ms: avgGpuMs ? Math.round(avgGpuMs) : null,
      cerebras_ttft_ms: avgCerebrasTtft ? Math.round(avgCerebrasTtft) : null,
      gpu_ttft_ms: avgGpuTtft ? Math.round(avgGpuTtft) : null,
      cerebras_tok_s: avgCerebrasTokS ? Number(avgCerebrasTokS.toFixed(1)) : null,
      gpu_tok_s: avgGpuTokS ? Number(avgGpuTokS.toFixed(1)) : null
    },
    savedReplay: false,
    savedAt: null
  };

  // Save full event timeline after every successful real race
  if (!isMock && validRounds.length > 0 && !clientController.signal.aborted) {
    summaryPayload.savedReplay = true;
    summaryPayload.savedAt = savedAt;
    emit('summary', summaryPayload);
    savedReplay = saveReplayTimeline({
      savedAt,
      thinking: thinkingOn ? 'on' : 'off',
      rounds,
      models: {
        cerebras: cerebrasModelDisplay,
        gpu: gpuModelDisplay
      },
      labels: {
        cerebras: 'Cerebras',
        gpu: config.gpuLabel || 'Kimi API (GPU)'
      },
      events: timelineEvents
    });
  } else {
    emit('summary', summaryPayload);
  }

  if (!res.writableEnded) {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost:3000';
    const urlObj = new URL(req.url || '/', `http://${host}`);
    const pathname = urlObj.pathname;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = fs.readFileSync(PUBLIC_INDEX_PATH, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      const config = getConfig();
      const replayMeta = getReplayMetadata();

      const settings = {
        CEREBRAS_API_KEY: Boolean(config.cerebrasApiKey),
        CEREBRAS_BASE_URL: Boolean(config.cerebrasBaseUrl),
        CEREBRAS_MODEL: Boolean(config.cerebrasModel),
        GPU_API_KEY: Boolean(config.gpuApiKey),
        GPU_BASE_URL: Boolean(config.gpuBaseUrl),
        GPU_MODEL: Boolean(config.gpuModel),
        GPU_LABEL: Boolean(config.gpuLabel)
      };

      const requiredKeys = ['CEREBRAS_API_KEY', 'CEREBRAS_MODEL', 'GPU_API_KEY', 'GPU_MODEL'];
      const missing = requiredKeys.filter(k => !settings[k]);

      const payload = {
        ok: true,
        settings,
        missing,
        models: {
          cerebras: config.cerebrasModel || null,
          gpu: config.gpuModel || null
        },
        labels: {
          cerebras: 'Cerebras',
          gpu: config.gpuLabel || 'Kimi API (GPU)'
        },
        mock: config.mock,
        replayExists: replayMeta.exists,
        replaySavedAt: replayMeta.savedAt
      };

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/race') {
      await handleRaceStream(req, res, urlObj.searchParams);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

const initialConfig = getConfig();
server.listen(initialConfig.port, () => {
  console.log(`Kimi Speed Race listening on http://localhost:${initialConfig.port} (MOCK=${initialConfig.mock ? '1' : '0'})`);
});
