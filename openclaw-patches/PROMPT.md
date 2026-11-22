# OpenClaw Speed Bounty — Clean Live Setup (`bounty-clean`)

100% live, zero-hardcoding, zero-caching setup built for **Santa's Speedy Shopper**:

- **100% Live Shopify Global Catalog calls**: [shopify-catalog-mcp.mjs](shopify-catalog-mcp.mjs) makes a fresh live HTTP POST to `https://catalog.shopify.com/api/ucp/mcp` on every `search_catalog` call — **no disk cache, no prewarming, no cached results**.
- **100% Authentic Retail Fields**: Returns only genuine Shopify fields (`name`, `url`, `price_aud` verified AUD or `null`, `store`) from 5 distinct retail stores (`Smartoon Kids`, `HipKids`, `Magnolia`, `Comfrt`, `PETstock Australia`), returning `null` if a search has no product.
- **Fast Server TPS**: Keeps `rTok` at Kimi K3.1 Pro's ~9–10 token floor on both calls, tight `max_completion_tokens`, fail-fast 429 retries (max 2 retries, 2s cap), and background title/workshop-review suppression.

## Apply to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Anti-Dispute Speed Bounty Prompt (Copy & Paste into `/new`)

```text
Call search_catalog 5x in parallel for Christmas gifts:
{"limit":1,"query":"kids toy","view":"compact"}
{"limit":1,"query":"teen desk","view":"compact"}
{"limit":1,"query":"candle","view":"compact"}
{"limit":1,"query":"blanket","view":"compact"}
{"limit":1,"query":"dog toy","view":"compact"}

No additional tool calls.

For each result, extract the actual product data:
name = product title
url = original product URL
price_aud = original price if AUD, otherwise null
store = original store name

Include exactly one result per category, preserving the
five-category order. If a search returns no product, use null.

Output only raw single-line JSON:
{"gifts":[{"name":"","url":"","price_aud":0,"store":""}]}
```
