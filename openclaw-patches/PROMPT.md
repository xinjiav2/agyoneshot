# OpenClaw Speed Bounty — Peak Top-TPS Live Setup (`prompt-turbo`)

100% live **Shopify Global Catalog** (`https://catalog.shopify.com/api/ucp/mcp`) setup with **zero hardcoded URLs** and **zero disk cache**, tuned specifically for **peak single-call Top TPS (`p90`)** on Cerebras Kimi K3.1 Pro (`Low` reasoning effort):

- **Peak Top-TPS Sweet Spot (`5call_turbo`)**: Keeps Call 1 ultra-lean (`in = 410`, `out = 337`, 3-key alphabetical `{limit, query, view}`) so Call 2 stays right at **`in = 1,275` (`cR = 1,024` cross-session KV cache hit, only `251` uncached tokens)** and **`out = 528`** — beating our previous `1,678` raw-URL shape by **+122 tok/s** under matched load (`1,525` vs `1,403 tok/s`)!
- **5/5 Live AUD Retail Products & Clean Canonical URLs**: Strips only Shopify's random tracking query parameters (`?variant=`, `&_gsid=`, `&utm_*`) in [shopify-catalog-mcp.mjs](shopify-catalog-mcp.mjs) and uses 5 distinct live AUD stores (`Smartoon Kids`, `HipKids`, `The Scented Market`, `Comfrt`, `PETstock Australia`) with a 100% consistent 13-key JSON schema (`view: "turbo"`).
- **OOM-Safe MCP + Clean `/new`**: 45s idle auto-exit in [shopify-catalog-mcp.mjs](shopify-catalog-mcp.mjs), fail-fast 429 retries (max 2 retries, 2s cap), and background dashboard session-title + `skill-workshop-review` calls disabled.

## Apply to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Winning Top-TPS Prompt (Copy & Paste into `/new` — 100% Live Shopify)

```text
Fast Christmas gift search: immediately call search_catalog 5 times in parallel in 1 turn with these exact arguments:
{"limit":1,"query":"kids toy","view":"turbo"}
{"limit":1,"query":"teen desk","view":"turbo"}
{"limit":1,"query":"soy candle","view":"turbo"}
{"limit":1,"query":"blanket","view":"turbo"}
{"limit":1,"query":"dog toy","view":"turbo"}
Never make a second tool call. After results arrive, output zero prose and no markdown—only one compact single-line JSON copying all 5 returned product objects verbatim into gifts:
{"gifts":[{"name":"","url":"","price_aud":0,"store":"","audience":"","description":"","reason":"","currency":"","availability":"","category":"","shipping":"","gift_wrap":"","return_policy":""}]}
```
