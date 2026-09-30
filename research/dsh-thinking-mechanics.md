# DSH 思考档位与图像模型 — 内部机制调研笔记

> 来源：本地反编译 `app.asar`（DSH 0.2.0-rc.1）中 `@deepseek-ai/dsh-llm-pi-ai` 与 `@earendil-works/pi-ai@0.85.1` 的实际代码，非猜测。

## 1. 架构链路

```
会话请求 → dsh-llm 服务 (ctx.llm.stream)
        → dsh-llm-pi-ai 适配器 (reasoningEffort 逻辑档位校验)
        → pi-ai (thinkingLevelMap 逻辑档位→wire 值映射)
        → 各 wire format (写具体的 JSON 字段)
```

- 配置入口：profile `cordis.patch.yml` 的 `llm-pi-ai` 条目 → `providers.<route>` 字典
- 逻辑档位词汇表（THINKING_LEVELS）：`off, minimal, low, medium, high, xhigh, max`
- 每模型 `thinkingLevelMap`：`{逻辑档位: wire值|null}`；`null`=不支持（UI 隐藏），缺失键=xhigh/max 默认不提供
- 插件配置是 volatile：改完 `cordis.patch.yml` 立即生效，无需重启

## 2. wire 字段映射（openai-completions 协议的 thinkingFormat，共 11 种）

| thinkingFormat | 发送的请求字段 |
|---|---|
| `openai`(默认) | `reasoning_effort: "<值>"`；off 时发 off 的 wire 字符串或省略 |
| `deepseek` | `thinking: {type:"enabled"/"disabled"}` + `reasoning_effort` |
| `openrouter` | `reasoning: {effort: "<值>"}`；off → `reasoning:{effort:"none"}` |
| `zai` (智谱GLM) | `thinking: {type:"enabled", clear_thinking:false}` + `reasoning_effort` |
| `qwen` (通义) | `enable_thinking: true/false` + `reasoning_effort` |
| `qwen-chat-template` | `chat_template_kwargs: {enable_thinking, preserve_thinking:true}` |
| `chat-template` | 自定义 `chat_template_kwargs`（支持 `$var: thinking.effort/budget/enabled` 占位） |
| `baseten` | `chat_template_args` + `reasoning_effort` |
| `together` | `reasoning: {enabled: bool}` + `reasoning_effort` |
| `string-thinking` | `thinking: "<字符串>"` |
| `ant-ling` | `reasoning: {effort: "<值>"}` |

其他协议：
- `openai-responses` → `reasoning: {effort, summary:"auto"}` + `include:["reasoning.encrypted_content"]`
- `anthropic-messages` → `thinking:{type:"enabled",budget_tokens:N}`；`forceAdaptiveThinking:true` 时 → `thinking:{type:"adaptive"}` + `output_config:{effort}`（effort 映射 low/medium/high）
- `google-generative-ai` → `thinkingConfig:{thinkingLevel:"MINIMAL/LOW/MEDIUM/HIGH", thinkingBudget:N}`；Gemini-3-pro 只有 LOW/HIGH
- token 预算：`compat.thinkingTokenBudgetField` ∈ `thinking_token_budget / thinking_budget / thinking_budget_tokens`；默认预算表 `{minimal:1024, low:2048, medium:8192, high:16384}`（`thinkingBudgets` 可覆盖）

## 3. pi-ai 内置目录的 thinkingLevelMap 实例（preset 数据源）

| 模型 | 映射 |
|---|---|
| gpt-5 | off/minimal/low/medium/high（无 xhigh/max） |
| gpt-5.1 | off:"none", low/medium/high |
| gpt-5.2 / 5.3-codex / 5.4 / 5.5 | off:"none" + low/medium/high/**xhigh** |
| gpt-5.6-luna/sol | off:"none" + low/medium/high/xhigh/**max** |
| deepseek-v4-flash (官方) | low/high/max（deepseek 格式） |
| glm-5.3 (zai) | 无 map；zai 格式 thinking:{type} 开关，无级差 |
| glm-5 (qwen-token-plan) | high:"high", max:"max"（经网关支持 effort） |
| qwen3.8-flash/max | low/medium/**xhigh**（注意没有 high！） |
| kimi-k3 | low/high/max |
| grok-4.6 | off:"none" + low/medium/high/xhigh |
| claude-opus-4.7/4.8/5 | xhigh/max（adaptive thinking） |
| gemini-3.1-pro | low:"LOW", high:"HIGH" |

目录统计：openrouter 351 模型（173 带 levelMap，222 支持图像输入）等 51 个 provider 文件。
内置图像目录：`pi-ai/dist/image-models.generated.js` — openrouter 下 51 个图像模型（qwen-image-3、gemini-3-pro-image、gpt-image-2、seedream-5、flux-2、recraft-v4…），走 chat.completions 的 `message.images`（data URL base64）形状。

## 4. 关键约束

1. **一协议一路由**：`api` 只能是 `openai-completions / openai-responses / anthropic-messages` 三选一；混协议模型须拆路由
2. **UJN 网关当前是 `openai-responses`**：该协议下 pi-ai 只发 `reasoning:{effort}`；GLM-5.3-Flash/Qwen3.8 等模型若走 completions 兼容端点，才能用 zai/qwen 专属格式
3. **assistant 图像输出被拒**：llm-pi-ai 对历史中 assistant image 抛 `UNSUPPORTED_CONTENT`——图像"生成"在 DSH 没有一等支持，必须插件自建通道
4. **UI 无任意档位输入**：composer 只显示 adapter 广告的 efforts；自定义档位须从配置面（models[].reasoningEfforts）进入
5. configEditor service（`entries/configuration/edit`）可程序化编辑 entry override，写完 HMR 热生效
6. 档位校验失败码：`UNSUPPORTED_REASONING_EFFORT`（请求前拦截，不发网络 I/O）

## 5. 插件结构范本（dsh-better-sidebar 实测）

```
package.json  →  dsh.bundle.patch: ./cordis.patch.yml
                 dsh.client.inject: [locale, ui-slots, ...]  platform: web
cordis.patch.yml → - insert: [{id, name}]
lib/index.js    →  host 半: export name/inject/Config/apply(ctx, config)
lib/client.js   →  client 半: export inject/apply(ctx)（React, slots）
locale/*.json   →  zh/en
```
安装：`dsh plugin --profile desktop add <pkg>`；本地开发可 `file:`/`github:` tarball。

## 6. 已有同类插件（差异化参考）

- `dsh-effort-slider`（2768651338）：Claude Code 风格推理滑块，无极拖动——证明 client 可改档位 UI
- `dsh-model-selector-search`（ArcaneOrion）：档位面板记住每模型上次选择
- 差异点：两者都**不解决"该发什么字段/值"的知识问题**，也不做图像模型——本插件的定位空间

## 7. 实测修订（2026-09-29，`scripts/probe-endpoint.mjs`）

上面第 3 节的表来自 pi-ai 目录的静态转录；本节是**对真实端点的实测**，两者不一致处以实测为准。

UJN 网关（`openai-responses`，`https://llm.ujn.edu.cn/v1`）：

```
未知名 effort  -> HTTP 400
  "reasoning_effort 取值必须为 none/minimal/low/medium/high/xhigh/max，当前值: definitely-not-an-effort"
```

→ 该网关**真实解析并校验** `reasoning.effort`，不是"接受但忽略"。插件的写入落在它认的字段上。

各档 reasoning_tokens（同一句 7 词提示词，仅取量级参考）：

| 档位 | GLM-5.3-Flash | Qwen3.8-Flash-Next |
|---|---|---|
| `none` | 0 | 0 |
| `minimal` | **0** | 20 |
| `low` | **0** | 21 |
| `medium` | **0** | 29 |
| `high` | 64 | 26 |
| `xhigh` | 43 | 27 |
| `max` | 44 | 27 |

两条修正：

1. **GLM-5.3 在该网关上 `high` 起才真正思考**。原表"glm-5 经网关支持 effort（high/max）"方向正确，
   但没说低档位是静默空转；实测证明 minimal/low/medium 思考量为 0。预设 `glm-gateway` 据此定为
   `high/xhigh/max`，并把这条实测结论写进 note。
2. **Qwen3.8 支持整条阶梯**（含原表未列的 `high`）。对它而言 `qwen38` 预设（low/medium/xhigh，无 high）
   在网关场景偏保守——原生预设描述的是 qwen 自带端点的开关语义，套到网关会少给档位。
   已验证的准确选择是 `openai-generic-effort`。

方法论：**端点是否真的响应 effort，本地没有任何测试能回答**——只能实测。插件因此附带
`probe-endpoint.mjs`；单句提示词下 reasoning_tokens 的信噪比有限，要分辨相邻档位需用更长任务。

配套的 `probe-image-endpoint.mjs` 用于另一类只能实测的问题：图像端点返回形状
（`data[0].b64_json` / `message.images[]` / Responses `output[]` …）在实现里只能靠猜。
