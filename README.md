# OpenClaw Speed Bounty — Santa's Speedy Shopper (Kimi K3.1 Pro on Cerebras)

High-throughput **OpenClaw** agent setup built for the **Speed Bounty**: running **Kimi K3.1 Pro (Cerebras)** on **`Low`** reasoning effort to execute **5 parallel Shopify Global Catalog `search_catalog` calls** in a single turn and return 5 verified Christmas gifts in compact JSON + a Cart view at **1,000–1,500+ tok/s (server)**.

---

## Setup Overview

- **Agent Runtime**: Local **OpenClaw Gateway** (`http://127.0.0.1:18789`, managed via `openclaw-gateway.service`).
- **Model & Provider**: **Kimi K3.1 Pro (Cerebras)** (`cerebras/moonshotai-kimi-k3.1-pro-trial`) via `https://api.cerebras.ai/v1` (`openai-completions`).
- **Reasoning Effort**: **`Low`** (`reasoning_effort: "low"`, `temperature: 0`).
  - `Low` is the fastest valid reasoning level for Kimi K3.1 Pro on Cerebras: turning reasoning completely off (`none`) is rejected by the model endpoint, while `medium`/`high` spends hundreds of free-form `<think>` tokens (~300 tok/s) that drag down throughput. At `Low`, reasoning stays around **7–15 tokens**, letting >95% of output tokens run through Cerebras's high-speed speculative decoder (**1,000–1,500+ tok/s**).
- **Catalog Tool**: Local stdio MCP server ([openclaw-patches/shopify-catalog-mcp.mjs](openclaw-patches/shopify-catalog-mcp.mjs)) registered as `shopify` in `~/.openclaw/openclaw.json`, exposing the unprefixed `search_catalog` tool directly on Turn 1 with `supportsParallelToolCalls: true`.

---

## Optimizations & Telemetry

1. **Server-Side Cerebras `tok/s` Telemetry**:
   - Captures `usage.completion_tokens / time_info.completion_time` directly from Cerebras streaming responses (`serverTps`) and propagates live `mean` and `p90` through OpenClaw's usage stream and transcript DB.
   - Displays the blue **`<mean> tok/s mean · <p90> p90 (server)`** pill in the OpenClaw bottom composer toolbar, live working indicator, and turn recap bar, matching [openclaw-speed-agent-shop25-video-cart-end.mp4](openclaw-speed-agent-shop25-video-cart-end.mp4).
2. **Transport & Prompt-Surface Slimming** ([openclaw-patches/apply-patches.mjs](openclaw-patches/apply-patches.mjs)):
   - Isolates `search_catalog` turns to a compact shopping system prompt and exposes only `search_catalog` (removing ~20,000 tokens of default OpenClaw workspace docs and 35 unused built-in tools).
   - Forces `temperature: 0`, `reasoning_effort: "low"`, `parallel_tool_calls: true`, and a tight `max_completion_tokens` cap to minimize Cerebras queue reservations and maximize speculative decoding acceptance.
3. **Cart View & Interactive JSON**:
   - Renders standalone `{"gifts":[...]}` responses in OpenClaw's collapsible `json` (`Tree | Raw`) viewer and opens the full-screen **`Santa's Speedy Shopper — Cart`** table (`#`, product title, store · audience · price, and clickable Shopify product URL) automatically after completion.

---

## Verified Benchmarks (`main` — AU/AUD Baseline)

Measured end-to-end through `openclaw-gateway.service` on `cerebras/moonshotai-kimi-k3.1-pro-trial` (`Low`):

| Run | Total Wall Time | Call 1 (`search_catalog` × 5) | Call 2 (Final JSON) | Mean / p90 (server) |
|---|---:|---:|---:|---:|
| **Run 1** | 7.94s | `762 tok/s` (`reason: 15`) | `1,346 tok/s` (`reason: 8`) | **`1,054 tok/s mean · 1,346 p90`** |
| **Run 2** | 8.88s | `855 tok/s` (`reason: 10`) | `926 tok/s` (`reason: 9`) | **`891 tok/s mean · 926 p90`** |
| **Run 3** | **3.00s** | `945 tok/s` (`reason: 10`) | **`1,500 tok/s`** (`reason: 11`) | **`1,223 tok/s mean · 1,500 p90`** |

- **3-run average**: **`1,056 tok/s mean`** (peaking at **`1,500 tok/s`** in **`3.00s`** total wall time).

---

## Quick Start

1. **Apply the OpenClaw patches and MCP server**:
   ```bash
   node openclaw-patches/apply-patches.mjs
   systemctl --user restart openclaw-gateway.service
   ```
2. **Open OpenClaw Control UI** at `http://127.0.0.1:18789` with model **Kimi K3.1 Pro (Cerebras)** and reasoning set to **`Low`**.
3. **Run the Speed Bounty prompt** from [openclaw-patches/PROMPT.md](openclaw-patches/PROMPT.md).

---

## Branches

- **`main`** *(recommended)*: Stable pre-USD **AU/AUD** baseline (`{name, url, store, price_aud}`, live Shopify Global Catalog fetch, `1,056`–`1,223 tok/s mean`, peak `1,500 p90`).
- **`testing`**: Experimental optimizations (startup pre-warm cache, 7-key contiguous verbatim product copy, alphabetical `{limit, query, view}` schema, `tool_choice: "required"`/`"none"`, and `429` contention controls).
