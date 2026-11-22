# Kimi 极速对决 — Cerebras 对比 GPU

**Kimi 极速对决（Kimi Speed Race）** 是一个零依赖的 Node.js 22+ 黑客松演示应用，用于直观对比 **Cerebras 平台上的 Kimi K3.1 Pro** 与运行在标准 GPU 基础设施上的同一模型之间的推理速度差异。

一键启动后，应用将自动完成以下流程：
1. **第一步（共享商品目录查询）**：服务端并行请求 **Shopify Global Catalog MCP API**（`https://catalog.shopify.com/api/ucp/mcp`），同时检索 5 个圣诞礼物类目（`kids toy`、`teen desk`、`candle`、`blanket`、`pet toy`），将返回数据精简为 `{category, items:[{title, url, store, price, currency}]}`，并把最小货币单位价格转换为美元/澳元数值。
2. **第二步（同屏实时竞速）**：服务端在同一时刻向 **Cerebras** 与 **Kimi API（GPU）** 发送完全一致的 OpenAI 兼容流式请求（`/chat/completions`）。
3. **实时对比与链接核验**：浏览器双通道并排流式展示实时计时器、首字延迟（TTFT）、吞吐速度（tok/s）、限流响应头，并严格核验模型返回的商品链接是否真实来自 Shopify 商品目录，最终呈现加速倍数横幅与 5 张可点击的圣诞礼物卡片。

---

## 环境配置与运行

1. 确认本机已安装 **Node.js 22+**（可运行 `node -v` 检查）。
2. 复制 `.env.example` 生成 `.env`：
   ```bash
   cp .env.example .env
   ```
3. 在 `.env` 中填入你的 API 密钥和模型名称：
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
4. 启动服务：
   ```bash
   npm start
   ```
   *（实际执行 `node --env-file=.env server.js`）*
5. 在浏览器中打开 `http://localhost:3000`。

---

## 在 VS Code 中运行

仓库已内置 `.vscode/launch.json` 调试配置：
1. 使用 VS Code 打开当前项目目录。
2. 确认项目根目录下已创建 `.env` 文件。
3. 点击 **运行 → 启动调试**（或直接按 **F5**），即可启动 **Kimi Speed Race Server**，并自动将 `envFile` 绑定到 `${workspaceFolder}/.env`。

---

## 如何保证对比公平

- **共享第一步检索**：5 路并行的 Shopify Global Catalog MCP 搜索仅在竞速开始前执行一次。其耗时单独计时展示，**绝不**计入任何一条推理通道的耗时。
- **完全一致的输入与超参数**：两条通道通过 `Promise.all` 在同一毫秒收到完全相同的系统提示词、精简后的 Shopify JSON 数据、`temperature: 0`、`max_tokens`（关闭思考模式时为 `800`，开启思考模式时为 `4000`）、`stream: true` 以及 `stream_options: {"include_usage": true}`。
- **剔除限流等待时间**：任何因 HTTP `429` 触发退避重试而产生的等待时间都不会计入通道计时器。通道计时器会在真正开始流式输出的那次请求上重新归零计时。
- **商品目录防幻觉核验**：任一模型返回的每一个商品链接都会与第一步 Shopify 返回的原始 `variants[0].url` 集合进行精确比对。任何编造或被篡改的链接都会被标记为 `"not from catalog"`。

---

## 限流处理、模拟模式与回放模式

### 限流处理（HTTP 429）
- 当遇到 HTTP `429`（或限流错误响应）时，对应通道会优先读取 `retry-after` 响应头并等待指定秒数；若无该响应头，则按 `2 秒`、`4 秒`、`8 秒` 进行指数退避，最多重试 **3 次**。
- 退避等待期间，通道计时器会重置并显示 `"rate-limited, retried N× (waited X s)"`。
- 若连续重试 3 次后仍被限流，该通道将被标记为 `"rate-limited"`，且本轮不展示加速比横幅。
- 任一服务商返回的 `x-ratelimit-*` 响应头都会以等宽小字直接显示在对应通道卡片上。

### 模拟模式（`MOCK=1`）
- 在 `.env` 中设置 `MOCK=1` 后，第一步仍会执行**真实的** Shopify Global Catalog 搜索，随后使用这些真实商品数据模拟两条模型输出流。
- 开启模拟模式时，页面顶部会显示高对比度的 **`MOCK DATA`** 提示横幅。

### 录制回放模式（`replays/latest.json`）
- 每次真实竞速成功后，服务端都会自动将完整的 SSE 事件时间线（包含相对毫秒时间戳）记录到 `replays/latest.json`。
- 点击 **Play saved run** 按钮（或请求 `GET /api/race?replay=1`）即可按原始节奏回放已保存的竞速过程，并显示 **`REPLAY of real run at <time>`** 横幅。
- 仓库已预置一份基线回放文件（`replays/latest.json`），开箱即可点击回放按钮，作为现场演示的兜底方案。

---

## 60 秒现场演示脚本

- **0:00 – 0:10 | 背景介绍**：
  *“我们正在并排运行两个后端上的 Kimi K3.1 Pro：左侧是 Cerebras 晶圆级引擎，右侧是标准 GPU API。两边都没有使用提示词缓存——我们现在直接从 Shopify Global Catalog 实时抓取真实商品。”*
- **0:10 – 0:25 | 一键开跑**：
  *点击 **Run race**（关闭 Thinking，选择 1 Round）。*
  *“可以看到第一步在大约 300 毫秒内并行拉取了 Shopify 的 5 个礼物类目。现在两条通道在同一瞬间收到完全相同的 JSON 和提示词。注意左侧 Cerebras 大约 160 毫秒就吐出首字，在右侧 GPU 通道刚起步时就已经生成完了整段结构化 JSON。”*
- **0:25 – 0:45 | 核验结果与礼物卡片**：
  *指向绿色加速倍数横幅，并向下滚动展示 5 张礼物卡片。*
  *“Cerebras 快了 7 倍以上。下方是选出的 5 件圣诞礼物——分别面向儿童、青少年、成人、祖父母和宠物——每一条商品链接都与 Shopify 目录返回结果做了严格校验，确保零幻觉链接。”*
- **0:45 – 1:00 | 思考模式 / 多轮测试 / 兜底回放**：
  *开启 **Thinking**（或切换到 3 轮），或示意 **Play saved run** 按钮。*
  *“即便现场黑客松 Wi-Fi 波动或触发 API 限流，我们的 429 自动退避机制也会将等待时间从计时中剔除，并且随时可以一键按原始速度回放最近一次真实运行记录。”*

---

## 设计细节说明

- **内置 `.env` 兜底加载器**：除了 `npm start` 中的 `node --env-file=.env server.js` 之外，`server.js` 还内置了轻量级 `.env` 解析兜底逻辑，直接运行 `node server.js` 也能正常读取 `.env` 而不会报错。
- **Token 与吞吐量计算**：输出 Token 数优先使用流式响应提供的 `usage.completion_tokens`，若接口未返回则按字符数估算（约 3.5 字符 / token）。若存在推理内容（`reasoning_content`），会单独统计并展示。吞吐速度（`tok/s`）按 `tokens / (total_ms / 1000)` 计算。
- **预置 `replays/latest.json`**：仓库内置了一份基于真实 Shopify Global Catalog 商品生成的基线时间线，方便在尚未配置正式 API 密钥前直接测试 `GET /api/race?replay=1` 与 **Play saved run** 按钮；每次真实竞速成功后都会自动覆盖更新。
