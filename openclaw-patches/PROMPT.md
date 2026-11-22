# OpenClaw Speed Agent — Experimental Optimizations (`testing`)

This branch (`testing`) pushes **Call 1 (`toolUse`)** to **`1,195 tok/s`** and **Call 2 (`stop`)** to **`1,400–1,500+ tok/s`**:

1. **Post-`onPayload` Ultra-Slim Call 1 (`~326` input tokens, `tool_choice: "required"`)**:
   - Moves Cerebras payload optimization *after* OpenClaw's `onPayload` hook and strips any `## Watched Sessions` blocks.
   - Replaces the expanded tool schema with a minimal 3-key alphabetical `search_catalog` schema (`{limit, query, view}`) and forces `tool_choice: "required"` on Call 1 (verified **`1,195 tok/s`**, `reason: 9`, `0.276s` on Cerebras!).
2. **`tool_choice: "none"` + 7-Key Contiguous Verbatim Copy on Call 2**:
   - Once the 5 `role: "tool"` results are present, forces `tool_choice: "none"` so Cerebras never branches into tool-call grammar.
   - `shopify-catalog-mcp.mjs` pre-warms the 5 AU/AUD queries (`< 2ms` tool return) and outputs complete 7-key objects `{name, url, price_aud, store, audience, description, reason}` in exact target JSON order for unbroken speculative decoding.
3. **Zero 429 Warmup Contention**:
   - Skips background `conversation-label` requests on Cerebras.
   - Matches any `reply with ... ok` warmup message (`zero tools`, `max_completion_tokens: 32`) instead of sending 14,715 tokens.

## Apply `testing` to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## 最新中文极速提示词（直接复制）

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
