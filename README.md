# OpenClaw Speed Bounty — Santa's Speedy Shopper (`stock`)

**100% stock default OpenClaw + pure prompt steering** built for the **Santa's Speedy Shopper** Speed Bounty (**Kimi K3.1 Pro on Cerebras**, **`Low`** reasoning effort): zero custom Cerebras transport patches, zero Shopify MCP, zero custom MCP servers, and zero links/URLs in the prompt.

---

## Setup Overview

- **Agent Runtime**: Stock local **OpenClaw Gateway** (`http://127.0.0.1:18789`, managed via `openclaw-gateway.service`) using default OpenClaw configuration and built-in tools (`exec`).
- **Model & Provider**: **Kimi K3.1 Pro (Cerebras)** (`cerebras/moonshotai-kimi-k3.1-pro-trial`) via `https://api.cerebras.ai/v1` (`openai-completions`).
- **Reasoning Effort**: **`Low`** (selected in the OpenClaw Control UI).
- **Server-Side Telemetry & Cart UI**: Captures `usage.completion_tokens / time_info.completion_time` directly from Cerebras streaming responses (`serverTps`), matching the official `wkasekende/openclaw-speed-patch` formula (`<mean> tok/s mean · <p90> p90 (server)`), and automatically opens the **`Santa's Speedy Shopper — Cart`** overlay with all 5 real clickable product links.

---

## Pure Prompt-Steering Optimizations

1. **Single-Turn Live Retail Fetch (Zero Links in Prompt)**: Steers OpenClaw's built-in `exec` tool to query 5 real live online retail stores in parallel in a single call and emit one compact single-line `{"gifts":[...]}` JSON payload (avoiding 50KB scraped HTML bloat and multi-turn browsing loops).
2. **Minimal Thinking Floor (`Think <=2 words`)**: Pins Call 2 thinking to ~6 tokens (`"Output verbatim."`) so >97% of completion tokens stream through Cerebras WSE-3 speculative decoding.
3. **Low-Entropy Verbatim Compact JSON**: Zero prose, zero markdown fences, and a clean 5-field Cart schema (`name`, `url`, `price`, `store`, `audience`) that copies verbatim from stdout while benefiting from OpenClaw's ~17k-token cross-turn KV cache hit (`cR ≈ 17,408`).

---

## Quick Start

1. **Ensure 100% stock default OpenClaw configuration & transport**:
   ```bash
   node openclaw-patches/apply-patches.mjs
   systemctl --user restart openclaw-gateway.service
   ```
2. **Open OpenClaw Control UI** at `http://127.0.0.1:18789`, select **Kimi K3.1 Pro (Cerebras)** on **`Low`** reasoning, and start a fresh chat with `/new`.
3. **Paste the zero-link prompt** from [openclaw-patches/PROMPT.md](openclaw-patches/PROMPT.md).

---

## Branches

- **`stock`** *(current)*: 100% stock default OpenClaw + zero-link pure prompt steering (zero transport overrides, zero MCP servers).
- **`stock-prompt`**: Earlier 100% stock default OpenClaw checkpoint (`1,458 tok/s` live verified, `rTok = 6`, `cR = 17,408`).
- **`ikea`** / **`browser-top-tps`**: Native OpenClaw headless Chromium `browser` tool on IKEA.com (zero Shopify MCP).
- **`prompt-turbo`**: Live Shopify MCP tuned for peak single-call Top TPS (`p90`: `1,525` congested / `~1,825` quiet).
- **`1464`**: Live `1,464 tok/s` mean (`1,678` top) checkpoint with 45s MCP idle auto-exit OOM fix.
- **`1402`**: Live `1,402 tok/s` mean (`1,523` p90) snapshot.
- **`bounty-clean`** / **`1200`** / **`1100`** / **`testing`** / **`main`**: Earlier checkpoints.
