# Kimi Speed Race — Cerebras vs GPU

**Kimi Speed Race** is a zero-dependency Node.js 22+ hackathon demo app that proves **Kimi K3.1 Pro on Cerebras** is dramatically faster than the same model running on standard GPU infrastructure.

With one click:
1. **Step 1 (Shared Catalog Fetch)**: The server queries the **Shopify Global Catalog MCP API** (`https://catalog.shopify.com/api/ucp/mcp`) across 5 gift categories in parallel (`kids toy`, `teen desk`, `candle`, `blanket`, `pet toy`), slimming the results to `{category, items:[{title, url, store, price, currency}]}` with minor-unit prices converted to dollars.
2. **Step 2 (Side-by-Side Race)**: The server fires identical OpenAI-compatible streaming requests (`/chat/completions`) at the exact same moment to **Cerebras** and **Kimi API (GPU)**.
3. **Live Comparison & Verification**: The browser streams both lanes side by side with live stopwatches, TTFT, tokens/sec, rate-limit headers, and strict URL verification against the Shopify catalog, finishing with a speedup banner and 5 clickable Christmas gift cards.

---

## Setup

1. Ensure you have **Node.js 22+** installed (`node -v`).
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Fill in your API keys and model names in `.env`:
   ```env
   CEREBRAS_API_KEY=your_cerebras_api_key_here
   CEREBRAS_BASE_URL=https://api.cerebras.ai/v1
   CEREBRAS_MODEL=kimi-k3.1-pro
   GPU_API_KEY=your_moonshot_kimi_api_key_here
   GPU_BASE_URL=https://api.moonshot.ai/v1
   GPU_MODEL=kimi-k3.1-pro
   GPU_LABEL=Kimi API (GPU)
   MOCK=0
   PORT=3000
   ```
4. Start the server:
   ```bash
   npm start
   ```
   *(Runs `node --env-file=.env server.js`)*
5. Open `http://localhost:3000` in your browser.

---

## Running from VS Code

A `.vscode/launch.json` configuration is included:
1. Open this folder in VS Code.
2. Make sure `.env` exists in the workspace root.
3. Go to **Run → Start Debugging** (or press **F5**) to launch **Kimi Speed Race Server** with `envFile` automatically bound to `${workspaceFolder}/.env`.

---

## How the Comparison is Kept Fair

- **Shared Step 1**: The 5 parallel Shopify Global Catalog MCP searches run once before the race begins. Their latency is timed and displayed separately and is **never** included in either lane's timer.
- **Identical Input & Hyperparameters**: Both lanes receive the exact same system prompt, slimmed Shopify JSON payload, `temperature: 0`, `max_tokens` (`800` when thinking is off, `4000` when thinking is on), `stream: true`, and `stream_options: {"include_usage": true}` at the same instant via `Promise.all`.
- **Rate-Limit Wait Exclusion**: Any time spent waiting on HTTP `429` backoff is excluded from the lane's stopwatch. The lane clock starts fresh on the attempt that actually begins streaming.
- **Catalog Hallucination Guard**: Every product URL returned by either model is verified against the exact `variants[0].url` set returned by Shopify in Step 1. Any invented or altered URL is flagged `"not from catalog"`.

---

## Rate Limits, Mock Mode, and Replay Mode

### Rate Limits (HTTP 429)
- On HTTP `429` (or a rate-limit error response), the lane checks the `retry-after` header and waits that many seconds; if absent, it backs off `2 s`, `4 s`, `8 s` for up to **3 retries**.
- During the backoff wait, the lane stopwatch resets and displays `"rate-limited, retried N× (waited X s)"`.
- If a lane is still rate-limited after 3 retries, it is marked `"rate-limited"` and the speed ratio banner is skipped for that round.
- Any `x-ratelimit-*` headers from either provider are displayed in small monospace text directly on the lane card.

### Mock Mode (`MOCK=1`)
- Setting `MOCK=1` in `.env` runs the **real** Step 1 Shopify Global Catalog search, then simulates the two model streams using the real Shopify products.
- Whenever mock mode is active, a high-contrast **`MOCK DATA`** banner is shown at the top of the page.

### Saved Replay Mode (`replays/latest.json`)
- After every successful real race, the server automatically records the full SSE event timeline (with relative millisecond timestamps) to `replays/latest.json`.
- Clicking **Play saved run** (or requesting `GET /api/race?replay=1`) replays the saved timeline at its original speed and displays a **`REPLAY of real run at <time>`** banner.
- A baseline replay file (`replays/latest.json`) is committed to the repository so the replay button works out of the box as a live demo backup.

---

## 60-Second Demo Script

- **0:00 – 0:10 | The Setup**:
  *"We're running Kimi K3.1 Pro on two backends side by side: Cerebras Wafer-Scale Engine on the left, and standard GPU API on the right. Neither uses cached prompts — we're fetching live products from Shopify's Global Catalog right now."*
- **0:10 – 0:25 | The One-Click Race**:
  *Click **Run race** (Thinking Off, 1 Round).*
  *"Watch Step 1 pull 5 gift categories from Shopify in ~300 ms. Now both lanes get the identical JSON and prompt at the exact same instant. Notice Cerebras hits first token in ~160 ms and finishes the entire structured JSON before the GPU lane barely starts."*
- **0:25 – 0:45 | Verification & Gift Cards**:
  *Point to the green speedup banner and scroll to the 5 gift cards.*
  *"Cerebras finished over 7× faster. Below are the 5 picked Christmas gifts — for kids, teens, adults, grandparents, and pets — with every product URL cryptographically matched against the Shopify catalog response so we know zero links were hallucinated."*
- **0:45 – 1:00 | Thinking Mode / Multi-Round / Backup Replay**:
  *Flip **Thinking** on (or select 3 rounds), or point out the **Play saved run** button.*
  *"Even if shared hackathon Wi-Fi or API rate limits hit, our automatic 429 backoff excludes wait time from the clock, and we can replay our last captured live run at exact original timing with one click."*

---

## Sensible Design Notes

- **Fallback `.env` Loader**: In addition to `node --env-file=.env server.js` in `npm start`, `server.js` includes a lightweight built-in `.env` fallback parser so running `node server.js` directly also loads `.env` without crashing.
- **Token & Throughput Calculation**: Output token counts use `usage.completion_tokens` when provided by the stream and fall back to character-based estimation (~3.5 chars/token) when omitted. Reasoning tokens (`reasoning_content`) are counted and displayed separately when present. Throughput (`tok/s`) is calculated as `tokens / (total_ms / 1000)`.
- **Pre-Seeded `replays/latest.json`**: A baseline timeline using real Shopify Global Catalog products is included in `replays/latest.json` so `GET /api/race?replay=1` and the **Play saved run** button can be tested immediately before live API keys are added. It is automatically overwritten after every successful real race.
