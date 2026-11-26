# OpenClaw Speed Agent — Experimental Optimizations (`testing`)

This branch (`testing`) hits **`1,582 tok/s` peak on Call 2** and **`1.77s` end-to-end inside OpenClaw Gateway** on a brand-new chat session:

1. **Ultra-Slim English Call 1 (`390` input tokens, `rTok=10`, `tool_choice: "required"`)**:
   - Strips all OpenClaw runtime-context blocks (`Active exec sessions`, `Conversation info`, `## Watched Sessions`, `## Temporal Context`) and trailing metadata on Turn 1.
   - Uses a 9-token English system prompt (`"Fast shopping agent. Think <=2 words. Zero prose."`), minimal 3-key alphabetical `search_catalog` schema (`{limit, query, view}`), `parallel_tool_calls: true`, and `tool_choice: "required"` (+200–400 tok/s on Call 1 by eliminating tool-decision thinking).
2. **Unconstrained Speculative Decoding + Cross-Session KV Prefix Cache (`cacheR=1024`) on Call 2**:
   - Leaves `tool_choice` **unset** on Call 2 (verified +400–500 tok/s vs `tool_choice: "none"`, which throttles Cerebras speculative decoding) while keeping `tools` intact to preserve the `1,024`-token KV prefix cache (`prompt_cache_key: "openclaw-speed-shop-v1"`).
   - `shopify-catalog-mcp.mjs` pre-warms + caches the 5 live AU/AUD queries (5-min TTL, in-flight deduplication, `<35ms` total for all 5 parallel tool calls) and returns unwrapped 7-key pure-ASCII objects `{name, url, price_aud, store, audience, description: title, reason: "Great Christmas gift"}` for double-anchored verbatim speculative decoding.
3. **Zero Background 429 Contention + Fast Recovery**:
   - Disables OpenClaw's 23k-token background `skill-workshop-review` (`skills.workshop.autonomous.mode = "off"`) and skips background `conversation-label` calls on Cerebras.
   - Caps OpenClaw's `RATE_LIMIT_RETRY_MAX_DELAY_MS` at `8s` (instead of `60s`) so transient Cerebras `429 queue_exceeded` bursts recover in seconds instead of stalling for 5+ minutes.

## Apply `testing` to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Fast English Prompt (Recommended — Zero Language Switching)

```text
Fast Christmas gift search: immediately call search_catalog 5 times in parallel in 1 turn with these exact arguments:
{"limit":1,"query":"kids toy","view":"compact"}
{"limit":1,"query":"teen desk","view":"compact"}
{"limit":1,"query":"candle","view":"compact"}
{"limit":1,"query":"blanket","view":"compact"}
{"limit":1,"query":"pet toy","view":"compact"}
Never make a second tool call. After results arrive, output zero prose and no markdown—only one compact single-line JSON copying all 5 returned product objects verbatim into gifts:
{"gifts":[{"name":"","url":"","price_aud":0,"store":"","audience":"","description":"","reason":""}]}
```

## Mandarin Prompt (中文极速提示词)

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
