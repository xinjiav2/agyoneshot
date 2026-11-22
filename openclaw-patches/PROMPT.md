# OpenClaw Speed Agent — Best AU/AUD Baseline (`main`)

This branch (`main`) stores the verified fastest AU/AUD OpenClaw configuration captured right before switching to USD:

## Verified 3-Run Benchmark Results (`moonshotai-kimi-k3.1-pro-trial` on Cerebras)

| Run | Wall Time | Call 1 (`search_catalog` × 5) | Call 2 (Final JSON) | Mean / p90 (server) |
|---|---:|---:|---:|---:|
| **Run 1** | 7.94s | `762 tok/s` (`reason: 15`) | `1,346 tok/s` (`reason: 8`) | **`1,054 tok/s mean · 1,346 p90`** |
| **Run 2** | 8.88s | `855 tok/s` (`reason: 10`) | `926 tok/s` (`reason: 9`) | **`891 tok/s mean · 926 p90`** |
| **Run 3** | **3.00s** | `945 tok/s` (`reason: 10`) | **`1,500 tok/s`** (`reason: 11`) | **`1,223 tok/s mean · 1,500 p90`** |

- **3-run average**: **`1,056 tok/s mean`** (peak `1,500 tok/s` in `3.00s` total wall time).

## Apply to Local OpenClaw

```bash
node openclaw-patches/apply-patches.mjs
systemctl --user restart openclaw-gateway.service
```

## Recommended Prompt (AU / AUD)

### Mandarin
```text
极速选品：同轮并行调用5次`search_catalog`（limit:1,view:"compact"），依次搜并绑定audience：
1."kids toy"->kids
2."teen desk"->teens
3."candle"->adults
4."blanket"->grandparents
5."pet toy"->pets
禁二次调用。返回后零思考直接输出单行JSON（严禁改动原name/url/store/price_aud，description复制name前2词，reason写"好礼"）：
{"gifts":[{"name":"","url":"","price_aud":0,"store":"","audience":"","description":"","reason":""}]}
```

### Verbatim-Args Prompt (Peak `1,223 tok/s mean · 1,500 p90`)
```text
Call search_catalog 5 times in parallel in 1 turn with exact args:
{"query":"kids toy","limit":1,"view":"compact"}
{"query":"teen desk","limit":1,"view":"compact"}
{"query":"candle","limit":1,"view":"compact"}
{"query":"blanket","limit":1,"view":"compact"}
{"query":"pet toy","limit":1,"view":"compact"}
Then with zero prose and no markdown, output single-line JSON copying name,url,store,price_aud verbatim (set description=name, reason="Christmas gift", audience in order: kids,teens,adults,grandparents,pets):
{"gifts":[{"name":"","url":"","price_aud":0,"store":"","audience":"","description":"","reason":""}]}
```
