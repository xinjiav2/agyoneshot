# OpenClaw Speed Bounty — Santa's Speedy Shopper (Kimi K3.1 Pro on Cerebras)

High-throughput **OpenClaw** agent setup built for the **Santa's Speedy Shopper** Speed Bounty: running **Kimi K3.1 Pro (Cerebras)** on **`Low`** reasoning effort to run **5 parallel live Shopify Global Catalog `search_catalog` calls** in a single turn and return 5 verified Christmas gifts from 5 distinct real retail stores in compact JSON + a Cart view.

---

## Setup Overview

- **Agent Runtime**: Local **OpenClaw Gateway** (`http://127.0.0.1:18789`, managed via `openclaw-gateway.service`).
- **Model & Provider**: **Kimi K3.1 Pro (Cerebras)** (`cerebras/moonshotai-kimi-k3.1-pro-trial`) via `https://api.cerebras.ai/v1` (`openai-completions`).
- **Reasoning Effort**: **`Low`** (`reasoning_effort: "low"`, `temperature: 0`).
  - `Low` is the fastest valid reasoning level on Cerebras Kimi K3.1 Pro (`none`/`minimal` are rejected by the endpoint, while `medium`/`high`/`max` emit hundreds of slow `<think>` tokens). With `temperature: 0` and a minimal system prompt, reasoning stays pinned at Kimi's **9–12 token** floor while >97% of output tokens run through Cerebras's high-speed speculative decoder.
- **100% Live Catalog Tool**: Local stdio MCP server ([openclaw-patches/shopify-catalog-mcp.mjs](openclaw-patches/shopify-catalog-mcp.mjs)) registered as `shopify` in `~/.openclaw/openclaw.json` with `supportsParallelToolCalls: true`. Every `search_catalog` call fetches **live** from `https://catalog.shopify.com/api/ucp/mcp` (zero disk cache, zero prewarming, strict AUD currency check).

---

## Key Optimizations & Telemetry

1. **Server-Side Cerebras `tok/s` Telemetry**:
   - Captures `usage.completion_tokens / time_info.completion_time` directly from Cerebras streaming responses (`serverTps`), matching the official `wkasekende/openclaw-speed-patch` formula (`<mean> tok/s mean · <p90> p90 (server)`).
   - Displays the blue `tok/s` pill in the bottom composer toolbar, live working indicator, and turn recap bar, and opens the **`Santa's Speedy Shopper — Cart`** overlay with all 5 verified retail links automatically.
2. **Two-Phase Transport Optimization** ([openclaw-patches/apply-patches.mjs](openclaw-patches/apply-patches.mjs)):
   - **Call 1 (`toolUse`)**: Strips OpenClaw runtime-context bloat down to **`~390` input tokens**, exposes only the alphabetical 3-key `search_catalog` schema (`{limit, query, view}`), and sets `parallel_tool_calls: true` + `tool_choice: "required"` to eliminate tool-decision thinking.
   - **Call 2 (`stop`)**: Deletes `params.tools`, `params.tool_choice`, and `params.parallel_tool_calls` once the 5 live tool results are back, disabling server-side tool-call grammar parsing during JSON generation and preserving unbroken verbatim speculative decoding across all 5 products.
   - **429 Contention Controls**: Disables background dashboard session-title calls and `skill-workshop-review` (`skills.workshop.autonomous.mode = "off"`), and sets fail-fast 429 retries (max 2 retries, 2s cap) so brief Cerebras `queue_exceeded` bursts don't stall for minutes.

---

## Quick Start

1. **Apply the OpenClaw patches and live Shopify MCP server**:
   ```bash
   node openclaw-patches/apply-patches.mjs
   systemctl --user restart openclaw-gateway.service
   ```
2. **Open OpenClaw Control UI** at `http://127.0.0.1:18789`, select **Kimi K3.1 Pro (Cerebras)** on **`Low`** reasoning, and start a fresh chat with `/new`.
3. **Paste the Speed Bounty prompt** from [openclaw-patches/PROMPT.md](openclaw-patches/PROMPT.md).

---

## Branches

- **`stock-prompt`** *(current — 100% Stock Default OpenClaw + Pure Prompt Steering)*: Zero custom Cerebras transport overrides, zero MCP servers, default OpenClaw config — pure prompt steering with built-in `exec` fetching 5 real live online retail stores (`Smartoon Kids`, `Corkcicle`, `Fellow`, `Comfrt`, `Ugmonk`) for **`1,458+ tok/s` Top TPS** (`rTok = 6`, `cR = 17,408` KV cache hit).
- **`ikea`** / **`browser-top-tps`**: 100% native OpenClaw headless Chromium `browser` tool on IKEA.com (zero Shopify MCP).
- **`prompt-turbo`**: 100% live zero-hardcoded-URL Shopify MCP tuned for peak single-call Top TPS (`p90`: `1,525` congested / `~1,825` quiet).
- **`1464`**: Live 1,464 tok/s mean checkpoint with 45s MCP idle auto-exit OOM fix.
- **`1402`**: 100% live no-cache Shopify MCP + Call 2 tool-drop optimization + unwrapped 7-field prompt (`1,402 tok/s mean · 1,523 p90` in 2s).
- **`bounty-clean`**: Clean live no-cache Speed Bounty branch.
- **`1200`** / **`1100`** / **`testing`**: Earlier experimental optimization checkpoints.
- **`main`**: Original stable AU/AUD baseline.
