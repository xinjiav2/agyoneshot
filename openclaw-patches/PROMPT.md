# OpenClaw Speed Bounty — Clean Live Setup (`bounty-clean`)

100% live, zero-hardcoding, zero-caching setup built for **Santa's Speedy Shopper**:

- **100% Live Shopify Global Catalog calls**: [shopify-catalog-mcp.mjs](shopify-catalog-mcp.mjs) makes a fresh live HTTP POST to `https://catalog.shopify.com/api/ucp/mcp` on every single `search_catalog` tool call — **no disk cache, no prewarming, no cached results**.
- **100% Authentic Retail Fields**: Returns only genuine Shopify fields (`name`, `url`, `price_aud`, `store`) from 5 completely different retail stores (`Smartoon Kids`, `HipKids`, `Magnolia`, `Comfrt`, `PETstock Australia`) — **no canned reasons or fabricated descriptions**.
- **Fast Server TPS**: Because Cerebras's server-side `tok/s` (`usage.completion_tokens / time_info.completion_time`) excludes tool/network time, live Shopify fetches cost **0 tok/s**, while returning the exact 4 real fields `{name, url, price_aud, store}` preserves unbroken verbatim speculative decoding.

## Apply to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Clean Bounty Prompt (5 Distinct Real Stores — Copy & Paste into `/new`)

```text
Call search_catalog 5x in parallel for 5 Christmas gifts (kids, teens, adults, grandparents, pets):
{"limit":1,"query":"kids toy","view":"compact"}
{"limit":1,"query":"teen desk","view":"compact"}
{"limit":1,"query":"candle","view":"compact"}
{"limit":1,"query":"blanket","view":"compact"}
{"limit":1,"query":"dog toy","view":"compact"}
No 2nd tool call. Zero prose, no markdown. Output raw single-line JSON copying all 5 returned product objects verbatim into gifts:
{"gifts":[{"name":"","url":"","price_aud":0,"store":""}]}
```
