# DSH Gearbox 插件开发规划

> 配套调研：[dsh-thinking-mechanics.md](./dsh-thinking-mechanics.md)（内部机制一手笔记）
> 状态：规划稿 v1 · 2026-02

## 0. 问题的根因（为什么现在做不到）

| 痛点 | 根因（源码级） |
|---|---|
| 接第三方模型无法选思考档位 | 手写的 `models[]` 没声明 `reasoningEfforts` → 适配器按 `reasoning:false` 处理 → composer 压根不渲染 Effort 行 |
| 不同模型档位字段不一样 | 档位→线上字段/值的映射分散在 `compat.thinkingFormat`（11 种）与每模型 `thinkingLevelMap` 里，手写极易错 |
| 想要"常用模型档位直接选" | pi-ai 内置目录其实已有 51 个 provider 的 levelMap，但没有 UI 暴露给手写路由 |
| 想要自定义字段 | 逻辑档位固定 7 档（off…max），但 **wire 值任意**（`max:"ultra"` 合法）；UI 无任意输入，只能从配置进 |
| 图像模型（截图中的 Qwen-Image 系列）不可用 | llm-pi-ai 对 assistant 图像输出直接抛 `UNSUPPORTED_CONTENT`；图像"生成"在 DSH 无一等支持，必须插件自建通道 |

## 1. 名称

**推荐：`dsh-gearbox`（DSH 变速箱）**——"档位"（thinking gears）+ "车道"（image lanes）双关；中文展示名 **"模型变速箱：思考档位 × 图像生成"**。

备选：`dsh-thinking-gears`、`dsh-effort-lab`、`dsh-model-tuner`。

- npm 包名：`dsh-gearbox`；loader entry id：`gearbox`；settingsNs：`dsh-gearbox`

## 2. 功能架构（一个插件，两个模块）

### 模块 A：Effort Studio（思考档位可视化配置）

```
内置预设库(bundled JSON, 源自 pi-ai 目录实测)
   ↓  用户在设置里选 route + model + 预设（或自定义）
插件合并生成 models[].reasoningEfforts + compat
   ↓  configEditor.edit("llm-pi-ai", …) 直接写 override
HMR 热生效 → composer Effort 行立刻出现正确档位
```

- 预设条目含：`api`、`compat.thinkingFormat`、`thinkingLevelMap`、`budget 字段`、适用模型 glob、说明文案（如 "z.ai 官方端点只有开/关；经网关才有 high/max"）
- 双通道落盘：**直接应用**（configEditor 写 `llm-pi-ai` entry，diff 预览 + 校验）或 **导出 YAML 片段**（保守派手动贴）
- 对目录内模型用 `modelOverrides`，对手写模型原位编辑 `models[]`
- 应用前本地校验，避免触发 `INVALID_CONFIG`/`assertServiceable` 拒写

### 模块 B：Image Lane（图像生成通道）

```
agent 工具 image_generate(prompt, refs?)
   ↓ (可选) 提示词增强: PE-T2I (text→text)
   ↓ (可选) 编辑指令改写: PE-I2I (image+text→text)
   ↓ 生成: Qwen-Image-2.1 (chat, 返回 image)
插件直接 fetch base URL（绕开 llm-pi-ai 的图像限制）
   ↓ 解析多种返回形状: message.images[] / content[].image_url / b64_json / data URL
存盘 <workdir>/.dsh-gearbox/<ts>.png → 返回路径 + markdown
```

- 用户的"三件套"模型做成 UJN 预设：`generator / promptEnhancer / editEnhancer`
- 兼容三种 API 风格：`chat`（OpenAI 兼容 chat.completions）、`images`（/v1/images/generations）、`siliconflow`（image_size/batch_size 变体）
- 凭据走 `ctx.credentials.resolve(apiKeyEnv)`，不落配置文件
- 另注册 `/image <prompt>` 命令 + 设置页手动面板（同一 host 路由 `/gears/api/image`）

## 3. 插件配置 Schema（schemastery，设置页自动渲染）

```ts
Config = z.object({
  rules: z.array(z.object({          // 档位规则（模块 A）
    route: z.string().optional(),    // 限定 provider 路由
    match: z.string().optional(),    // 模型 id glob，如 "glm-*"
    preset: presetId.optional(),     // 内置/自定义预设 id
    efforts: z.dict(z.union([z.string(), z.const(null)])).optional(),  // 显式覆盖
    compat: z.object({ thinkingFormat: formatEnum }).optional(),
    budgets: z.object({ low: z.number(), medium: z.number(), high: z.number() }).optional()
  })),
  presets: z.dict(presetDef),        // 用户自定义预设（可引用内置）
  applyMode: z.union(["auto", "yaml"]),
  image: z.object({                  // 模块 B
    providers: z.dict(z.object({
      baseURL: z.string(),
      apiKeyEnv: z.string().role("credential-ref"),
      style: z.union(["chat", "images", "siliconflow"]),
      generator: z.string(),
      promptEnhancer: z.string().optional(),
      editEnhancer: z.string().optional()
    })),
    defaultProvider: z.string().optional(),
    saveDir: z.string().default(".dsh-gearbox"),
    autoEnhance: z.boolean().default(true)
  })
})
```

## 4. 内置预设库（v1 收录，全部来自本地源码实测）

| 预设 id | 适用 | api + format | 档位映射 |
|---|---|---|---|
| `openai-gpt5` | gpt-5 全系 | responses / 默认 | off:"none" (5.1+)，low/med/high；5.2+ 加 xhigh；5.6+ 加 max |
| `deepseek-v4` | deepseek-v4-* | completions / deepseek | thinking:{type} + low/high/max |
| `glm-zai` | glm-5.x（z.ai 官方） | completions / zai | 仅开/关（thinking:{type}），无级差 |
| `glm-gateway` | glm-5.x（经 qwen 网关） | completions / qwen | high:"high", max:"max" |
| `qwen38` | qwen3.8-* | completions / qwen | enable_thinking + low/medium/**xhigh**（无 high！） |
| `kimi` | kimi-k2 系 | completions / deepseek | 仅开/关；k3: low/high/max |
| `claude-adaptive` | claude-opus-4.7+ | anthropic / adaptive | xhigh/max（output_config.effort） |
| `claude-budget` | claude-4 系 | anthropic / budget | thinking:{type:enabled, budget_tokens}，预算 1024/8192/16384 |
| `gemini` | gemini 2.5/3.x | completions 兼容或原生 | thinkingLevel MINIMAL/LOW/MEDIUM/HIGH；2.5 走 thinkingBudget |
| `grok` | grok-4.6+ | responses / 默认 | low..xhigh |
| `openrouter` | 任意 openrouter 模型 | completions / openrouter | reasoning:{effort}，off→"none" |
| `ujn-image` | 截图三件套 | chat 风格 | 模块 B 三角色预设 |

每个预设带：适用模型 glob、note 文案（UI 显示"适用：…"）、budget 字段名。

## 5. 关键技术点与风险

| 点 | 结论 |
|---|---|
| 写别人插件的配置 | `configEditor.edit(entry, change)` 官方服务，走 Loader 正常路径，HMR 自动生效 ✅ |
| 注册 agent 工具 | `ctx.tools.register(ToolDefinition)` ✅ |
| 读凭据 | `ctx.credentials.resolve(ref)`；capabilities 需声明 `credentials`+`network`（市场会标红线，README 披露） |
| 图像解析 | 并存 4 种返回形状，按序探测；流式关掉（stream:false） |
| 协议限制 | `api` 仅 3 种；原生 Google/Bedrock 协议不在 DSH 暴露面内——扩展方向是自注册 `LlmAdapter`（二期） |
| 配置校验 | 写入前本地跑同款校验逻辑，避免 assertServiceable 拒绝整次保存 |
| 双挂载 | cordis.patch.yml 用 `disabled: !!js` 表达式防聚合 bundle 重复挂载（better-sidebar 同款） |

## 6. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 骨架 | 包结构 + 插件配置 + 内置预设库 + host/client 打通 | 插件出现在设置页，预设可浏览 |
| M2 Effort Studio | 规则编辑 + configEditor 直写 + YAML 导出 | UJN 的 GLM-5.3-Flash / Qwen3.8 出现正确档位行，请求实测带对字段 |
| M3 Image Lane | image_generate 工具 + UJN 三件套 + 存盘 | 对话里让 agent 画图成功落盘 |
| M4 打磨 | /image 命令、面板、locale、README | 提交 awesome-dsh-plugin PR |

## 7. 目录结构

```
dsh-gearbox/
├─ package.json          # dsh.bundle.patch + dsh.client.inject
├─ cordis.patch.yml      # - insert: [{id: gearbox, name: dsh-gearbox}]
├─ lib/index.js          # host: name/inject=['llm','tools','fs','credentials']/Config/apply
├─ lib/client.js         # client: 设置节 + 面板
├─ lib/presets.js        # 内置预设库（本调研产物）
├─ lib/image-lane.js     # 图像生成管线
├─ src/ locale/ icon.svg README.md
```
