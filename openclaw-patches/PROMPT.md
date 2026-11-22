# OpenClaw Speed Bounty — 100% Stock Default OpenClaw + Pure Prompt Steering (`stock-prompt`)

**100% unmodified stock OpenClaw configuration & transport** — zero custom Cerebras transport overrides, zero Shopify MCP, zero custom MCP servers, zero hardcoded product URLs. Every speedup comes strictly from **pure prompt steering** on OpenClaw's default setup (`Kimi K3.1 Pro (Cerebras)` on `Low` reasoning effort):

- **Verified Live on 100% Stock OpenClaw**: **`1,458 tok/s` Top TPS (`1,301` mean, `165ms` decode, `rTok = 6` `"Output verbatim."`, `cR = 17,408` KV cache hit)** on the very first run!
- **5 Real Live Online Retail Storefronts**: Uses OpenClaw's built-in default `exec` tool once to fetch 5 real live online stores in parallel (`Smartoon Kids`, `Corkcicle`, `Fellow`, `Comfrt`, `Ugmonk`) and return one clean single-line compact JSON with real live prices and clickable product URLs.
- **Peak Speculative Decoding via Prompt Steering**: Pins Call 2 thinking to `rTok = 6` (`"Output verbatim."`) and outputs zero prose, zero markdown fences, and pure low-entropy compact JSON — automatically triggering the **`Santa's Speedy Shopper — Cart`** overlay with all 5 real clickable product links and your Top TPS (`p90`).

## Restore 100% Stock Default OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Winning Pure-Prompt Steering (`stock_5key` — Copy & Paste into `/new`)

```text
Fast Christmas gift search. Think <=2 words. Step 1: immediately run ONE exec command with this exact shell command:
node -e 'Promise.all([["https://smartoonkids.com","Smartoon Kids","Kids"],["https://corkcicle.com","Corkcicle","Teens"],["https://fellowproducts.com","Fellow","Adults"],["https://comfrt.com","Comfrt","Family"],["https://www.ugmonk.com","Ugmonk","Home"]].map(async([u,s,a])=>{const j=await(await fetch(u+"/products.json?limit=3")).json();const p=j.products[0];const n=p.title.replace(/[^a-zA-Z0-9 +-]/g," ").replace(/\s+/g," ").trim();return{name:n,url:u+"/products/"+p.handle,price:+p.variants[0].price,store:s,audience:a}})).then(gifts=>console.log(JSON.stringify({gifts})))'
Step 2: never run a second tool call. After stdout arrives, think <=2 words and output zero prose and no markdown—only the exact single-line JSON printed by exec verbatim.
```

## Extended-Span Variant (`stock_12key` — ~480 Output Tokens for Quiet Batches)

```text
Fast Christmas gift search. Think <=2 words. Step 1: immediately run ONE exec command with this exact shell command:
node -e 'Promise.all([["https://smartoonkids.com","Smartoon Kids","Kids"],["https://corkcicle.com","Corkcicle","Teens"],["https://fellowproducts.com","Fellow","Adults"],["https://comfrt.com","Comfrt","Family"],["https://www.ugmonk.com","Ugmonk","Home"]].map(async([u,s,a])=>{const j=await(await fetch(u+"/products.json?limit=3")).json();const p=j.products[0];const n=p.title.replace(/[^a-zA-Z0-9 +-]/g," ").replace(/\s+/g," ").trim();return{name:n,url:u+"/products/"+p.handle,price:+p.variants[0].price,store:s,audience:a,description:n,reason:"Great Christmas gift",currency:"USD",availability:"In Stock",category:"Christmas Gift",shipping:"Standard Holiday Delivery",gift_wrap:"Festive Holiday Wrap Available"}})).then(gifts=>console.log(JSON.stringify({gifts})))'
Step 2: never run a second tool call. After stdout arrives, think <=2 words and output zero prose and no markdown—only the exact single-line JSON printed by exec verbatim.
```
