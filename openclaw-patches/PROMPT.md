# OpenClaw Speed Bounty — 100% Stock Default OpenClaw + Zero-Link Pure Prompt (`stock`)

**100% unmodified stock OpenClaw configuration & transport** — zero custom Cerebras transport overrides, zero MCP servers, and **zero links or URLs in the prompt**. Every speedup comes strictly from **pure prompt steering** on OpenClaw's default configuration (`Kimi K3.1 Pro (Cerebras)` on **`Low`** reasoning effort):

- **Zero Links in Prompt**: No URLs, domains, or hardcoded product links anywhere in the prompt — the agent discovers and fetches 5 real live online products with live prices and real clickable product links at runtime via OpenClaw's built-in default `exec` tool.
- **Peak Speculative Decoding via Prompt Steering**: Keeps Call 2 thinking to `<= 2` words (`rTok ≈ 6`, `"Output verbatim."`) and streams compact single-line JSON with zero prose and no markdown fences — automatically opening the **`Santa's Speedy Shopper — Cart`** overlay with all 5 real clickable product links and your Top TPS (`p90`).

## Restore 100% Stock Default OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Zero-Link Pure Prompt (Copy & Paste into `/new` on **`Low`** Reasoning)

```text
Fast Christmas gift search. Think <=2 words. Step 1: immediately run ONE exec call using Node fetch in parallel across 5 real online retail stores (Smartoon Kids, Corkcicle, Magnolia, Comfrt, and Ugmonk) to fetch each store's live product catalog, pick 1 real in-stock product from each store for Kids, Teens, Adults, Family, and Home with its real live price and direct clickable product page URL, and print ONLY one compact single-line JSON to stdout with schema {"gifts":[{"name":"","url":"","price":0,"store":"","audience":""}]}. Step 2: never run a second tool call. After stdout arrives, think <=2 words and output zero prose and no markdown—only the exact single-line JSON printed by exec verbatim.
```

## Fully Generic Zero-Link / Zero-Brand Variant

```text
Fast Christmas gift search. Think <=2 words. Step 1: immediately run ONE exec call using Node fetch in parallel across 5 distinct real online retail stores of your choice to fetch live product catalogs, pick 1 real in-stock Christmas gift from each store for Kids, Teens, Adults, Family, and Home with its real live price and direct clickable product page URL, and print ONLY one compact single-line JSON to stdout with schema {"gifts":[{"name":"","url":"","price":0,"store":"","audience":""}]}. Step 2: never run a second tool call. After stdout arrives, think <=2 words and output zero prose and no markdown—only the exact single-line JSON printed by exec verbatim.
```
