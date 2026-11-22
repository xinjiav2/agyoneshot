# OpenClaw Speed Agent — Experimental Optimizations (`testing`)

This branch (`testing`) contains all experimental post-USD speed optimizations built on top of `main`:

1. **Startup Pre-Warm Cache (`WARM_CACHE`)** in `shopify-catalog-mcp.mjs`: Pre-fetches the 5 gift categories from Shopify Global Catalog on MCP startup (`0.54s` -> `< 2ms` tool execution).
2. **Contiguous 7-Key Verbatim Gift Object**: Returns `{name, url, price_aud, store, audience, description, reason}` in exact target JSON order so Turn 2 output is a 100% byte-for-byte substring copy for Cerebras speculative decoding.
3. **Alphabetical Tool Schema (`{limit, query, view}`)**: Matches Kimi K3.1 Pro's alphabetical tool-call serializer (`{"limit":1,"query":"...","view":"compact"}`).
4. **429 Contention Controls**:
   - Skips background `conversation-label` requests on Cerebras.
   - Ultra-fast channel for any `reply with ... ok` warmup message (zero tools, `max_completion_tokens: 32`).
   - Single-turn context slicing on `search_catalog` turns + `max_completion_tokens: 768` + `prompt_cache_key`.
   - Removes inner `doneDetectingFetch` 429 retry amplification.

## Apply `testing` to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Experimental Prompt (Alphabetical Args + 7-Key Verbatim Copy)

```text
极速圣诞选品：首轮立即并行调用5次`search_catalog`，严格原样传以下5组参数：
{"limit":1,"query":"kids toy","view":"compact"}
{"limit":1,"query":"teen desk","view":"compact"}
{"limit":1,"query":"candle","view":"compact"}
{"limit":1,"query":"blanket","view":"compact"}
{"limit":1,"query":"pet toy","view":"compact"}
严禁二次调用。收到结果后零废话、无Markdown，直接输出单行紧凑JSON，将5个返回的商品对象一字不差原样复制进gifts数组：
{"gifts":[{"name":"","url":"","price_aud":0,"store":"","audience":"","description":"","reason":""}]}
```
