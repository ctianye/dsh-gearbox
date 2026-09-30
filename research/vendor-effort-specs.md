# 思考档位官方规格调研（2026-09-30）

> 目的：为「厂家 → 模型」层级预设提供**官方**依据。每条都注明来源；未逐字核对官方文档的项标注 ⚠。
>
> **一个前提必须先说清**：本插件写入的是 `llm-pi-ai` 的 `models[].reasoningEfforts`，
> **线上字段由 pi-ai 的适配器按路由 `api` 翻译**。所以下表的"传输字段"是①给用户看的事实、
> ②给 UI 说明用；插件本身不直接拼这些字段。协议决定"用哪种请求体"，档位决定"值"。

## 一、各家规格

### OpenAI（developers.openai.com/api/docs/guides/reasoning）
- Chat Completions：顶层 **`reasoning_effort`**；Responses：嵌套 **`reasoning.effort`**
- 值集：`none / minimal / low / medium / high / xhigh / max`，**按模型收窄**
  - gpt-5.6：全部六档（无 minimal），默认 **medium**
  - gpt-5.2：none/low/medium/high/xhigh；gpt-5.2-pro 仅 medium/high/xhigh
  - 更早的 reasoning 模型：仅 low/medium/high
- 同一厂家不同 API 值集不同（Realtime 只有 minimal…xhigh，默认 low）

### DeepSeek（api-docs.deepseek.com，官方）
- 开关（OpenAI 格式）：`{"thinking": {"type": "enabled"|"disabled"}}`
- 开关（Responses 格式）：`{"reasoning": {"effort": "none"|"low"|"high"|"max"}}`，**none 即关**
- 强度（OpenAI 格式）：**`reasoning_effort: "low"|"high"|"max"`**，默认 **high**（思考默认开）
- 强度（Anthropic 格式）：`{"output_config": {"effort": "low"|"high"|"max"}}`
- **官方映射表**（v4-flash 与 v4-pro 一致）：请求 effort → 实际 effort
  `low→low, medium→high, high→high, xhigh→high, max→max, ultra→max`
- 实际只有 **3 档**：low / high / max。适用于 deepseek-v4-flash、v4-pro、v4.1-flash
- 阿里云百炼补充：v4-flash-0731 与 v4-pro-0813 支持 low；v4-pro/v4-flash 在百炼上 low/medium→high、xhigh→max

### Anthropic（docs.anthropic.com / console.anthropic.com）
- 档位制：**`output_config.effort`**（**不在 thinking 对象里**）：`low/medium/high/xhigh/max`，默认 **high**（high 等价于不传）
- 预算制并存：`thinking: {type:"enabled", budget_tokens: N}`（硬上限，旧机制）
- effort 影响**全部输出 token**（含工具调用与参数），不只是思考
- 按模型可用性不同（"不是所有支持 max 的都支持 xhigh"）
- Claude Opus 5+：思考默认开；`thinking:{type:"disabled"}` 仅当 effort ≤ high 才接受，否则 **400**

### Google Gemini（ai.google.dev）
- 原生：`generationConfig.thinkingConfig.thinkingLevel`，枚举 **minimal/low/medium/high**（Vertex 文档为大写）
- Gemini 2.5 系**不支持 thinkingLevel**，用 `thinkingConfig.thinkingBudget`（数值；0=关，-1=动态）
- **Gemini 3 系与 2.5 Pro 不能关思考**
- OpenAI 兼容层：`reasoning_effort`，官方映射 effort→thinking_level/budget：
  minimal→minimal/1024、low→low/1024、medium→medium/8192、high→high/24576
- 默认按模型：3.1 Pro=high，3.5 Flash=medium

### Qwen / 百炼（alibabacloud.com 帮助文档）
- 三件套：**`enable_thinking`**（顶层布尔）、**`thinking_budget`**（顶层整数）、**`reasoning_effort`**（顶层字符串）
- **qwen3.8 系列**：默认 **xhigh**；可选 xhigh/medium/low；`max→xhigh、high→xhigh、minimal→low、none→enable_thinking=false`
  - **不支持 reasoning_effort 与 thinking_budget 同设**；互转 low=4096、medium=16384、xhigh=262144
- 只有 **3 档**，且命名与 OpenAI 不同

### GLM（智谱；经百炼）
- `thinking:{type}` 开关 + `clear_thinking`（历史思考控制）
- **glm-5.3**（百炼直供）：默认 **max**；可选 max/high/low；**始终思考，`enable_thinking:false` 会报错**
- glm-5 / 5.1 / 5.2：high/max（low、medium→high；xhigh→max）

### Kimi（月之暗面；经百炼）
- kimi-k3：`reasoning_effort` high/max（默认 high）；**不支持 thinking_budget**

### xAI Grok ⚠
- grok-3-mini：`reasoning_effort: low|high`；grok-4 无档位控制（自适应）
- ⚠ 本条未逐字核对 xAI 官方文档，依据为 OpenRouter 归一化文档

### OpenRouter（聚合层，openrouter.ai/docs）
- 统一对象：`reasoning: { effort | max_tokens | exclude | enabled }`
- effort：`max/xhigh/high/medium/low/minimal/none`（OpenAI 风格），按百分比映射 token
- `GET /api/v1/models` 返回 `reasoning.supported_efforts / default_effort / mandatory` 元数据 —— **可作为"该模型支持哪些档位"的机器可读来源**

## 二、对插件设计的结论

1. **没有统一字段**。五种形态：①OpenAI 扁平 `reasoning_effort`；②嵌套开关+强度（DeepSeek/GLM `thinking:{type}`）；
   ③Anthropic `output_config.effort`（档位）与 `thinking.budget_tokens`（预算）并存；
   ④Gemini `thinkingConfig.thinkingLevel`/`thinkingBudget`；⑤百炼 `enable_thinking`（顶层布尔）。
2. **档位集合不通用，且同一厂家内按型号收窄**（OpenAI 按代、GLM 按型号、DeepSeek 3 档）。
   → "厂家 → 模型"层级是正确结构；预设必须**只列真实档位**，把"会被映射的档位"列出来就是给用户假档位。
3. **映射而非拒绝**是常态（DeepSeek medium→high、xhigh→high；百炼 low/medium→high、xhigh→max）。
   → 自定义 UI 允许用户写映射值，但预设只写官方真档位。
4. **图像/无思考模型**（Qwen-Image、PE 系列）没有档位 → 不应出现档位选择。
5. **协议 ≠ 档位**：`thinkingFormat` 只有 openai-completions 收；`reasoningEfforts` 三种 api 都收。
   协议切换是"把模型移到哪种请求体的路由"，与档位正交。
6. 想要"机器可读的档位集合"，聚合层（OpenRouter）的 `supported_efforts` 元数据是最佳实践参考。
