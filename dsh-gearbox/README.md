# dsh-gearbox

[English](#english) | 中文

**模型变速箱：第三方模型思考档位 × 图像生成通道。**

DSH 接入第三方大模型时的两个堵点，一个插件解决。

---

## Effort Studio — 思考档位

问题不在 DSH 缺能力，而在**配置面没把知识暴露出来**：接第三方模型时选不了思考档位，是因为手写的 `models[]` 没声明 `reasoningEfforts`，适配器就按"非思考模型"处理，composer 连 Effort 行都不渲染。而每家的字段与取值又各不相同：

| 端点形态 | 实际发出的字段 | 档位 |
|---|---|---|
| OpenAI Responses | `reasoning:{effort}` | `none` / minimal / low / medium / high / xhigh / max |
| OpenAI Completions (`openai`) | `reasoning_effort` | 同上 |
| DeepSeek | `thinking:{type}` + `reasoning_effort` | low / high / max |
| 智谱 z.ai 官方端点 | `thinking:{type}` | **只有开 / 关**，无级差 |
| 通义 | `enable_thinking` + `reasoning_effort` | qwen3.8 是 low / medium / **xhigh**——没有 high |
| OpenRouter | `reasoning:{effort}` | off → `"none"` |
| Anthropic 自适应 | `thinking:{type:adaptive}` + `output_config.effort` | xhigh / max |
| Anthropic 预算 | `thinking:{type:enabled, budget_tokens:N}` | token 预算 1024 / 8192 / 16384 |

本插件内置 **16 组预设**（全部抄自 DSH 内置 pi-ai 目录的实测映射），按模型名自动推荐，选中即用；也支持完全自定义（任意档位 → 任意线上值，如 `max: "ultra"`）。

### 三条设计要点

1. **协议感知**。`thinkingFormat` 只有 `openai-completions` 收；写在 `openai-responses` 路由的模型上会被适配器直接判为非法，**整次配置保存一起失败**。插件按路由真实 `api` 裁剪 compat，并把裁剪结果作为"适配说明"回报，不静默丢弃。
2. **空档位会被拒**。非 `off` 档位写 `null` 是非法写法（"only off may leave it empty"）；"该端点没有这一档"的正确表达是**省略该键**。预设翻译层已按此处理。
3. **写入前本地校验**。`INVALID_CONFIG` 会否掉整个 `config`，一条坏规则会连带用户其它规则一起丢。插件先把每条规则按适配器同款规则过一遍，不合法的单独拒绝并报告。

### 两种生效方式

- **直写**（`applyMode: auto`）：走官方 `configEditor` 服务写进 `llm-pi-ai` 的 profile 行，配置是 volatile，写完即对下一次请求生效。写入幂等——配置重载会重新激活插件，不会反复写。
- **导出 YAML**：保守派手动粘贴。`POST /gears/api/export` 或 `/gears/api/validate`（干跑，不写）。

写 `models[]` 还是 `modelOverrides` 由路由形态决定，插件自动判断——两者**互斥**，同时出现会被适配器拒绝：
手写 `models:` 的路由改 `models[]` 条目；只靠内置目录的路由写 `modelOverrides[<id>]`（否则会以一条残缺条目顶掉目录里的上下文窗口与模态声明）。

## Image Lane — 图像生成

DSH 对 assistant 图像输出直接抛 `UNSUPPORTED_CONTENT`，图像生成没有一等支持，必须插件自建通道。

### 供应商 / 模型 / 协议：三件互相解耦的事

```
provider   只放连接事实：baseURL、凭据引用、附加头
model      一个 id，原样作为请求体的 model 发出
protocol   这次调用打到哪个端点 —— 绑在「模型」上，不是绑在「供应商」上
```

这是刻意的：**同一个供应商下不同模型可以走不同协议，不同供应商也可以用同一个协议**。
所以一条 Image Lane 配置里可以同时有：

| 角色 | 职责 | 协议 |
|---|---|---|
| `generator` | 文生图 | `images-generations` 或 `chat` |
| `editor` | 图生图（可多张参考图） | `images-edits` 或 `chat` |
| `promptEnhancer` | 提示词扩写（PE-T2I） | `chat` |
| `editEnhancer` | 编辑指令改写（PE-I2I） | `chat` |

### 三种 API 协议

| 协议 | 端点 | 请求 | 返回 |
|---|---|---|---|
| `images-generations` | `POST /v1/images/generations` | JSON，文生图。`bodyStyle: siliconflow` 时改用 `image_size`/`batch_size` | `data[0].b64_json`（PNG，解码即存）或 `data[0].url` |
| `images-edits` | `POST /v1/images/edits` | **multipart 表单**，图生图，最多 `maxInputImages`（默认 4）张输入图 | 同上 |
| `chat` | `POST /v1/chat/completions` | JSON；可带图片内容块 | 文本（增强器）或图像块（作生成器时） |

`images-edits` 刻意不手写 `Content-Type`：multipart 的 boundary 由 `fetch` 自己写，
手动设置会让服务端无法解析。上传字段名可用 `imageField` 改（部分端点要求 `image[]`）。

### 档位（每个模型一套）

档位 = **具名的请求体字段包**："这个模型在这个档位上，就把这些字段发出去"。
插件**不发明字段名**——`gears.standard: { size: "1024x1024", n: 1 }` 就只合并这两个键：

```yaml
roles:
  generator:
    model: Qwen-Image-2.1
    protocol: images-generations
    gears:
      standard: { size: "1024x1024", n: 1 }
      wide:     { size: "1280x720",  n: 1 }
    gear: standard            # 默认档位
```

调用时可覆盖：工具参数 `gear`、命令 `--gear <名>`、HTTP 路由 `{"gear":"wide"}`。
`chat` 角色的档位同样是任意字段，例如 `gears.deep: { reasoning_effort: "high" }`。

### 其它

- 增强器是真调用，也真慢：实测 PE-T2I 7.9s、PE-I2I 18.8s。所以默认**不声明 `timeoutMs`**
  （DSH 只对插件自己声明的超时设限，图像任务本就不该被默认超时掐断）；需要上限就按角色配 `timeoutMs`
- 解析六种返回形状：`data[0].b64_json` / `data[0].url` / Responses `output[]` / `message.images[]` /
  `message.content[]` / 顶层 `images[]`
- 凭据走 DSH 凭据服务（`ctx.credentials.resolve`），或环境变量兜底；**永不写入配置文件**
- 三个入口共用一条实现：agent 工具 `image_generate`、`/image` 命令、HTTP 路由 `POST /gears/api/image`
- 落盘 `<会话工作区>/<saveDir>/gearbox-<ts>.png`，返回路径与 markdown 供展示
- **旧配置格式仍兼容**：原先 provider 上的 `style`/`generator`/`promptEnhancer`/`editEnhancer`/`size`
  会自动折算成角色（`lane.roles[*].source === "provider-flat"`），不必手改

## 安装

```sh
dsh plugin --profile <name> add dsh-gearbox
```

插件必须同时在 profile 的 bundle 栈里（`dsh.profile.bundles`）。bundle 层只在启动时组合，
所以新增插件需要重启一次；此后的配置改动都走 HMR，不用重启。

## 配置

**设置 → 插件 → dsh-gearbox。** 配置表单由本插件的 `Config` schema 自动渲染，预设与
`thinkingFormat` 是**下拉选择**而非自由输入——写错会在保存时被拒，而不是静默写成一条不起作用的配置。

```yaml
- id: gearbox
  name: "dsh-gearbox"
  config:
    applyMode: auto
    rules:
      - route: ujn
        model: GLM-5.3-Flash
        preset: glm-gateway
      - route: ujn
        model: Qwen3.8-Flash-Next
        preset: qwen38
    image:
      providers:
        ujn:
          baseURL: https://llm.example.com/v1
          apiKeyEnv: MY_API_KEY
          style: chat
          generator: Qwen-Image-2.1
          promptEnhancer: Qwen-Image-PE-T2I
          editEnhancer: Qwen-Image-PE-I2I
          size: 1024x1024
      defaultProvider: ujn
      saveDir: .dsh-gearbox
      autoEnhance: true
```

## `/image` 命令

```
/image <提示词> [--ref <路径|URL|data URL>] [--provider <名>] [--size 1024x1024] [--no-enhance]
```

`--ref` 一给就切到图生图通道：参考图会同时进入 PE-I2I 增强请求与生成请求。

## 在 DSH 里怎么打开

| 入口 | 位置 | 说明 |
|---|---|---|
| **设置 → 模型变速箱** | DSH 设置对话框左侧导航 | 插件注册的 `settings.section` 分节，内嵌下面那个设置页（带主题适配）。**改动客户端半后需重载窗口（Ctrl+R）或重启应用才出现** |
| `/gears/ui` | 插件自带网页 | 同一份内容，独立打开时更宽敞 |
| 对话输入区 | 选模型后 | 档位选择器（off / low / high / …），取决于该模型是否已配档位 |
| `/image` 命令 | 对话输入框 | 生成/编辑图片 |
| `image_generate` 工具 | agent 调用 | 同上，返回落盘路径 |

设置页是**表单驱动**的，不要求你懂配置文件：

- **档位**：一排芯片（off / minimal / low / medium / high / xhigh / max）点选即选。
  「推荐预设」下拉是快捷方式——选一个预设会把它的档位**预填进芯片**，再点「保存档位」生效。
  非标准取值（某端点要求 `high:"enabled"`）收在「高级」折叠里，不影响日常使用。
- **图像通道**：每个角色的供应商、模型、**协议**都是下拉/输入框，改完点「保存图像通道」。
- 每个模型卡片上常驻显示**「前端实际可用」**的档位——那是 composer 渲染选择器的依据，
  配置写进去了但这里还是"—"，说明没生效。
- 所有改动**保存即生效**，不需要重启或重载窗口。
- 最近一次写入：时间、来源、尝试次数、错误、被拒原因、协议适配说明

> 插件页的「配置 模型变速箱」来自 DSH 插件管理器的 config ledger + Host 的 settings RPC，
> 第三方插件控制不了它是否出现。这个页面是插件自己提供的，不依赖那条链路。

| 路由 | 说明 |
|---|---|
| `GET /gears/ui` | **设置页（HTML）** |
| `GET /gears/api/info` | 状态摘要：预设数、路由、最近一次写入结果与适配说明、Image Lane 解析后的配置 |
| `GET /gears/api/presets` | 预设库全文 |
| `GET /gears/api/inventory` | 各路由模型 + **适配器实际对外提供的档位** |
| `GET /gears/api/rules` | 当前生效的规则与 applyMode |
| `POST /gears/api/validate` | 干跑：只报告会写什么、会拒什么 |
| `POST /gears/api/apply` | `{rules}` → 直写 llm-pi-ai |
| `POST /gears/api/export` | `{rules}` → 可粘贴的 YAML 片段 |
| `POST /gears/api/image` | `{prompt, images?, provider?, gear?, size?}` → 生成/编辑图片 |

## 开发

```sh
node scripts/harness.mjs          # 本地验证台：mock ctx 跑通 apply / 工具 / 命令 / 路由 / 客户端半
node scripts/setup-dev-links.mjs  # 为 dev 目录接上 DSH 运行时依赖闭包（仅 linked 开发需要）
node scripts/wire-check.mjs       # 从**已写入的配置**推导线上请求体
node scripts/probe-endpoint.mjs ujn <model> high max   # 实测端点认不认 reasoning_effort
node scripts/probe-image-endpoint.mjs ujn <model>      # 实测图像端点真实返回形状
```

### 为什么需要 `setup-dev-links.mjs`

插件的 host 半按裸名导入 `@deepseek-ai/*`，DSH 把这份依赖闭包装在
`<DSH_HOME>/profiles/node_modules`，Node 从**真实路径**逐级向上找 `node_modules`。
已发布的插件天然满足（装在闭包下层），但跨盘 `file:` 链接的开发目录（`D:\...` → `C:\...`）
会断链，症状是 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`。
该脚本在插件目录里放一组 junction 补上这一跳。仅开发需要，`node_modules/` 已被忽略且不进发布包。

### 两个踩过的坑（写给下一位）

- **client bundle 是经典 script**。`dsh-app://` 下 ESM `import` 是语法错误；而且它和所有插件
  拼成一段脚本，一条坏语句会掀翻整个渲染层，紧接着崩溃恢复会清掉 profile 配置。
  必须用 `window.__ModuleLoader__.load({ id, factory })`。
- **`inject` 只认扁平数组**。`{ required, optional }` 这种写法在这个 cordis 版本里会被当成
  要两个名叫 `required`/`optional` 的服务，插件永久 `pending`，路由一个都不注册。

---

## English

**Gearbox: reasoning-effort presets for third-party models × an image-generation lane.**

The plugin exists because the two blockers are *knowledge* problems, not capability problems.

### Effort Studio

A hand-written `models[]` that omits `reasoningEfforts` makes the adapter treat the model as
non-reasoning, and the composer then renders no Effort row at all. Meanwhile every vendor spells
its gears differently — `reasoning_effort` for OpenAI (with `xhigh` only from gpt-5.2, `max` from
gpt-5.6), `thinking:{type}` for DeepSeek, an on/off switch on the z.ai endpoint, `enable_thinking`
for Qwen where qwen3.8 has low/medium/**xhigh** and no `high` at all.

Sixteen presets transcribed from the pi-ai catalog shipped inside DSH, auto-suggested by model id.
Three things the plugin gets right that a hand-written config does not:

1. **Protocol awareness.** `thinkingFormat` is a `openai-completions`-only switch. Naming it on a
   model whose route is `openai-responses` fails resolution and discards the *entire* config save.
   The plugin trims compat to what the route's `api` accepts and reports each trim as an adaptation
   note instead of dropping it silently.
2. **Empty gears are rejected.** A valueless non-`off` level is invalid — only `off` may leave it
   empty. "This endpoint has no such gear" is expressed by *omitting the key*.
3. **Local admission before writing.** `INVALID_CONFIG` denies the whole `config`, so one bad rule
   would cost the user every other rule in the same write. Each rule is checked against the
   adapter's own rules first and refused individually.

`models[]` versus `modelOverrides` is chosen from the route's shape, because the adapter refuses
the two together: a hand-declared route edits its `models` entries, a catalog-backed route gets
only the changed fields in `modelOverrides[<id>]` (a bare `models` entry would shadow the catalog
entry and lose its context window and modalities).

### Image Lane

DSH rejects assistant image blocks outright, so image generation has no first-class support and
needs its own lane. Two lanes, chosen by whether a reference image was supplied: text→image
through the PE-T2I prompt enhancer, or image→image through PE-I2I, which rewrites the edit
instruction against the reference and passes the reference on to the generator.

Enhancers are real and slow (7.9 s and 18.8 s measured), so the tool deliberately declares no
`timeoutMs` — DSH only enforces a timeout a tool asks for. Five response shapes are parsed; three
API styles are supported; credentials come from the DSH credential store and never reach a config
file. One implementation backs the `image_generate` tool, the `/image` command and the HTTP route.

### Configuration

The settings form is rendered from this plugin's `Config` schema, with `preset` and
`thinkingFormat` as pickers rather than free text — a typo is refused at save time instead of being
written as a config that silently does nothing. See the Chinese section for a full YAML example.

### Development

See the Chinese section: `scripts/harness.mjs` runs the plugin against a faithful mock host,
`wire-check.mjs` derives the request body from the *written* config, and the two `probe-*`
scripts measure what an endpoint actually honours — which is the one thing no local test can settle.
