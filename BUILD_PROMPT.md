
Build a hackathon demo app called **Kimi Speed Race** in this project folder (the open workspace, a git repo). Work only inside this folder. Don't ask me questions — make sensible choices and note them in the README.

## What it does
A Christmas gift picker that proves Kimi K3.1 Pro on Cerebras is faster than the same model on GPUs. One click:
1. The server runs 5 Shopify Global Catalog searches in parallel (kids toy, teen desk, candle, blanket, pet toy).
2. It sends the identical results and identical prompt to two lanes at the same moment: Cerebras (Kimi K3.1 Pro) and a GPU provider (the same model on the Kimi API).
3. The page streams both lanes side by side with live timers, then shows the gift cards and how many times faster Cerebras was.

## Tech rules
- Node.js 22+ with built-ins only (http, fs, fetch). No npm dependencies, no framework, no build step.
- Start command: `node --env-file=.env server.js` (put it in package.json as `npm start`).
- One server file, one `public/index.html` with inline CSS and vanilla JS.
- API keys stay on the server. Never print, log, or commit key values.

## Files
- `server.js`
- `public/index.html`
- `package.json` ("type": "module", "start" script, engines node >=22, no dependencies)
- `.env.example`:
  ```
  CEREBRAS_API_KEY=
  CEREBRAS_BASE_URL=https://api.cerebras.ai/v1
  CEREBRAS_MODEL=
  GPU_API_KEY=
  GPU_BASE_URL=https://api.moonshot.ai/v1
  GPU_MODEL=kimi-k3.1-pro
  GPU_LABEL=Kimi API (GPU)
  MOCK=0
  PORT=3000
  ```
- `.gitignore`: `.env`, `runs.jsonl`, `node_modules/`, `.DS_Store`
- `replays/` folder (committed, not ignored).
- `.vscode/launch.json`: a Node launch config that runs server.js with `envFile` set to `${workspaceFolder}/.env`, so I can start it with Run → Start Debugging.
- `README.md`: what it is, setup (copy .env.example to .env, fill keys), how to run from VS Code, how the comparison is kept fair, how rate limits and mock/replay work, and a 60-second demo script.

## Step 1 — Shopify search (server)
- POST to `https://catalog.shopify.com/api/ucp/mcp` with headers `Content-Type: application/json` and `Accept: application/json, text/event-stream`. No API key is needed.
- JSON-RPC body per query:
  ```json
  {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{
    "meta":{"ucp-agent":{"profile":"https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json"}},
    "catalog":{"query":"kids toy","view":"compact","pagination":{"limit":2},
      "context":{"address_country":"AU","currency":"AUD"},
      "filters":{"ships_to":{"country":"AU"}}}}}}
  ```
- Run all 5 with `Promise.all`. Handle the response whether it comes back as plain JSON or as an SSE `data:` line. If the server insists on an MCP `initialize` handshake first, do it once and reuse the session.
- Products are in `result.structuredContent.products[]`. Use the first variant: `variants[0].url` (keep exactly, including query params), `variants[0].seller.name`, `variants[0].price.amount` and `.currency`. Prices are in minor units — divide by 100 on the server.
- Slim each category to `{category, items:[{title, url, store, price, currency}]}` before sending to the model, to keep the input small.
- If a query returns nothing with the ships_to filter, retry that one query once without `filters`.
- Time this step separately. It is shared by both lanes and not part of either lane's timer.

## Step 2 — the race (server)
- Both lanes call `{BASE_URL}/chat/completions` (OpenAI-compatible) at the same moment with identical: messages, `temperature: 0`, `max_tokens` (800 with thinking off, 4000 with thinking on), `stream: true`, `stream_options: {"include_usage": true}`.
- System prompt (use exactly):
  ```
  你是极速圣诞选品代理。输入是5个类目的Shopify搜索结果（JSON）。
  每类选1件最适合送礼的商品，只用输入数据，严禁编造：
  name=title；url原样复制；store=store；price_aud=price（已是元，两位小数），currency不是AUD则填null；
  audience固定：kids toy→kids，teen desk→teens，candle→adults，blanket→grandparents，pet toy→pets；
  description≤8字，reason≤5字；某类无结果则该位置为null。
  零废话、无推理、无Markdown，只输出单行JSON：
  {"gifts":[{"name":"","url":"","price_aud":0.00,"store":"","audience":"","description":"","reason":""}]}
  ```
  User message: the slimmed JSON from step 1.
- Thinking toggle: when off, add `"thinking":{"type":"disabled"}` to the request. If an endpoint answers 400 because of that field, retry once without it and show "thinking setting not supported" on that lane.
- Per lane, measure: time to first token (counting `reasoning_content` deltas too), total time, output tokens (from `usage.completion_tokens`; estimate from text length if missing), and tokens/sec. Count reasoning tokens separately when the stream includes `reasoning_content`.
- 120-second timeout per lane with AbortController. One lane failing must not stop the other.
- Parse each lane's final text as JSON (strip code fences if present). Check that every returned url exists in the Shopify results; flag any that don't as "not from catalog".
- Append one line per lane per run to `runs.jsonl`: timestamp, lane, model, thinking, ttft_ms, total_ms, tokens, tok_s, valid_json, urls_verified, retries, waited_ms.

## Rate limits (important)
- The Cerebras key is shared and often rate-limited. On HTTP 429 or a rate-limit error, wait for `retry-after` seconds if the header is present, otherwise back off 2 s, 4 s, 8 s. Retry up to 3 times.
- Time spent waiting on a 429 is NOT counted in the lane's timer. Start the lane's clock fresh on the attempt that succeeds, and show "rate-limited, retried N× (waited X s)" on that lane.
- If a lane is still rate-limited after 3 retries, mark it "rate-limited" and skip the speed ratio for that round.
- Show any `x-ratelimit-*` response headers in small text on the lane.

## Mock and replay mode
- `MOCK=1` in .env: skip all model calls and stream a built-in sample race using the real Shopify results. This is for building the UI only. Show a large "MOCK DATA" label whenever it's on.
- After every successful real race, save its full event timeline to `replays/latest.json` (commit this file). `GET /api/race?replay=1` plays it back at the original speed, labeled "REPLAY of real run at <time>". This is the backup for the live demo.

## Endpoints
- `GET /` serves `public/index.html`.
- `GET /api/health` returns which settings are present as true/false, model names, whether MOCK is on, and whether a saved replay exists. Never return key values.
- `GET /api/race?thinking=off&rounds=1` streams Server-Sent Events: shopify (ms, counts), lane start, lane token/reasoning deltas, lane rate-limit/retry, lane done (metrics + parsed gifts), lane error, round done, and a final summary. `rounds` 1–10 runs races back to back, reusing the step-1 results, and the summary reports averages.
- `GET /api/race?replay=1` streams the saved replay with original timing.

## Page
- Dark, clean, readable on a projector. Title "Kimi K3.1 Pro: Cerebras vs GPU".
- Controls: Run race button, Play saved run button (disabled if no replay exists), thinking on/off switch, rounds selector (1, 3, 5).
- A small line showing the Shopify step time.
- Two lanes side by side: name and model, a big live stopwatch, TTFT, tokens/sec, total time, retry/wait status, rate-limit headers, and the streaming output (thinking text in grey).
- When both finish: a banner like "Cerebras was 7.4× faster (1.2 s vs 8.9 s)" using total time, plus averages when rounds > 1.
- A clear "MOCK DATA" or "REPLAY of real run at <time>" banner whenever either mode is active.
- Below: 5 gift cards from the Cerebras result (name, store, price in AUD, audience, description, reason, "View product" button linking to the url). Show a warning badge on any card that failed url verification.
- If /api/health shows missing keys, show a clear message saying which ones to add to .env.

## Check your work
1. Run `node --check server.js`.
2. Start the server in the background, call `/api/health`, and confirm the page loads.
3. Test the page with MOCK=1 first. Then make at most ONE real race call (`curl -N "http://localhost:3000/api/race?thinking=off&rounds=1"`). Don't loop on real calls. If it's rate-limited, report that and stop.
4. Stop the server.
5. `git add` everything except `.env` and `runs.jsonl`, and commit with the message "Kimi Speed Race: first working version". Don't push.

When done, reply with: the files you created, the test results, anything that didn't work, and exactly which values I still need to put in `.env`.
