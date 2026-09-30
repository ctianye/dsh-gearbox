# dsh-gearbox 开发状态

> 续接自 DSH 会话（`session-df65f6b0`，2026-09-29 02:30 中断于第 23 轮），现于 workbuddy 环境继续。
> 断点：M1 代码完成，卡在"真实 DSH 环境验证"；M2/M3 代码已写但未在真实环境跑通。

## 断点定位（续接时确认）

原会话最后一步是运行 mock 验证台，失败于 `node:fs:560`——`@deepseek-ai/schemastery` 找不到。
根因不在 harness 的映射表写错，而是**插件在真实运行时下根本无法解析依赖**：

插件 dev 目录在 `D:\dsh_pludge\dsh-gearbox`，DSH 运行时依赖闭包在 `C:\Users\cheng\.dsh\profiles\node_modules`。
Node 从导入文件的**真实路径**逐级向上找 `node_modules`，跨盘断链：

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'
  imported from D:\dsh_pludge\dsh-gearbox\lib\config.js
```

已发布的插件不会有这个问题（装在闭包下层）；只有跨盘 `file:` 链接的开发目录会。
`scripts/setup-dev-links.mjs` 在插件目录内放一组 junction 补上这一跳。

## 阶段性状态

| 阶段 | 状态 | 真实 DSH 验证 |
|---|---|---|
| M1 骨架 | ✅ 完成 | ✅ 隔离 profile（真实 runtime，独立端口）激活无错；`/gears/api/info`、`/presets`、`/inventory`、`/rules` 全部 200；`image_generate` 工具注册 |
| M2 Effort Studio | ✅ 完成 | ✅ 规则直写 `llm-pi-ai` 落盘；`inventory` 显示适配器**实际对外提供**的档位与声明完全一致（GLM-5.3：off/high/xhigh/max；Qwen3.8：off/minimal/low/medium/high/xhigh/max）；写前本地校验拦掉非法规则 |
| M3 Image Lane | ⚠️ 插件侧完成，末段被上游阻断 | 增强器真调用已验证（PE-T2I 7.9s、PE-I2I 18.8s）；**生成器 502 上游故障**（见下） |
| M4 打磨 | ✅ 完成（自定义面板除外） | `/image` 命令已注册（`commands: image`）；设置表单由 Config schema 自动渲染；locale 双语；README 完整 |
| 免重启挂载 | ✅ 完成 | desktop profile 的 `cordis.patch.yml` 加 `insert` 行，HMR 热生效——`/gears/api/info` 404 → 200，**未重启**，无新崩溃日志 |

## M2 实测结论（一手数据）

用 `scripts/probe-endpoint.mjs` 对 UJN 网关（`openai-responses`）实测：

- 未知 effort → **HTTP 400**，报错明确列出合法值：`none/minimal/low/medium/high/xhigh/max`
  → 该端点**真实校验并响应** `reasoning.effort`，插件的写入落在它认的字段上
- `reasoning_tokens` 随档位变化：GLM-5.3 `high`=64、`xhigh`=43、`max`=44；`minimal/low/medium`=0

由此得到的可操作结论：

- **GLM-5.3-Flash 在该网关实际只有 `high` 起才思考**。插件里 `glm-gateway` 预设据此定为
  `high/xhigh/max`——低档位端点会接受但思考量为 0，列出来只会误导 UI
- **Qwen3.8-Flash-Next 支持整条阶梯**（minimal…max 都有非零 reasoning_tokens）。
  对它而言原生厂商预设 `qwen38`（low/medium/xhigh，无 high）会偏保守，
  已验证的准确选择是 `openai-generic-effort`

## 遗留问题

### 1. 上游图像生成器不可用（阻断 M3 末段）

```
$ node scripts/probe-image-endpoint.mjs ujn Qwen-Image-2.1 "..."
/chat/completions   -> 502  {"error":{"message":"模型服务返回 500：Image generation failed: Stage-0 has no live replica"}}
/images/generations -> 502  同上
/responses          -> 400  "Qwen-Image-2.1 是图片生成模型，不支持 Responses API，请使用 /v1/images/generations 或 /v1/chat/completions"
```

两个不同端点返回同一句错误 → 不是请求形状问题，是网关侧图像后端没有存活副本。
旁证：同网关的文本模型（GLM-5.3-Flash）正常，两个增强模型 PE-T2I / PE-I2I 也正常（200）。
**待上游恢复后需补一次真实出图 + 落盘验证**；插件侧无需改动。

### 2. 自定义面板（预设浏览 + 一键应用）

当前"设置 → 插件 → dsh-gearbox"的表单由 `lib/config.js` 的 schema 自动渲染，`preset` 与
`thinkingFormat` 是下拉选择，已可用。缺的是一个**浏览预设库并一键应用**的自定义 UI：
它需要注册进 `@deepseek-ai/dsh-client-ui-settings` 的插槽并使用 `dsh-client-ui-primitives`
的 React 组件，而插槽名必须由父级声明的子表声明。

**有意未做**：无法在本环境渲染验证的前提下手写渲染层组件，风险是重演"客户端语法错误 →
渲染层崩溃 → 崩溃恢复清空 profile 配置"那条路径。host 侧接口已全部就位
（`GET /presets|/inventory|/rules`、`POST /apply|/export|/validate`），补 UI 时不需要动 host。

### 3. `patchReload` 与 bundle 的双挂载边界

desktop profile 未在 manifest 里声明 `patchReload`，取 `web` 模板默认值 `live`，因此 patch 文件热生效。
挂载行 id 特意用 `gearbox-dev` 而非 `gearbox`：插件自带的 bundle patch 会在"已有其它*
启用*条目挂载 `dsh-gearbox`"时禁用自己那一行（id `gearbox`），用不同 id 可保证日后把包加进
`bundles` 时仍然只挂载一次。

### 4. 已修正的四个真实缺陷（均由验证发现，非推测）

| 缺陷 | 发现方式 | 后果 |
|---|---|---|
| 非 `off` 档位写显式 `null` | 读 `resolveModelReasoning` | 适配器判非法，**整次配置保存一起失败** |
| 同路由多条规则互相覆盖 | 真实环境落盘比对 | 后一条规则把前一条的写入整个抹掉 |
| `applyMode: auto` 从未执行 | 真实环境落盘比对 | 声明了"保存即生效"但实际不写 |
| `inject: { required, optional }` | 真实 DSH 启动日志 | cordis 不解析该写法，插件永久 `pending`，路由一个都不注册 |

前两个是 harness 抓到后补的断言；后两个只有跑真实 DSH 才能发现——mock 造不出 cordis 的 inject 解析行为。

## 验证工具（可复用）

| 脚本 | 作用 |
|---|---|
| `scripts/harness.mjs` | mock ctx 跑通 apply / 工具 / 命令 / 路由 / 客户端半；含 30+ 断言 |
| `scripts/setup-dev-links.mjs` | 为 dev 目录补 DSH 运行时依赖闭包 |
| `scripts/wire-check.mjs` | 从**已写入的配置**推导线上请求体（复刻适配器 + pi-ai 的翻译规则） |
| `scripts/probe-endpoint.mjs` | 实测端点认不认 `reasoning_effort`，并对比各档 reasoning_tokens |
| `scripts/probe-image-endpoint.mjs` | 实测图像端点真实返回形状与可用性 |

隔离验证 profile：`C:\Users\cheng\.dsh\profiles\gearbox-check`（`node_modules` 指向 desktop 的闭包）。

```sh
# 启动隔离实例（独立端口，不碰桌面应用）
ELECTRON_RUN_AS_NODE=1 "D:\dsh\DeepSeek Harness.exe" \
  D:\dsh_pludge\asar-extract\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js \
  --profile gearbox-check --no-open --port 3399
```

## 备份

- `profile-backups/desktop-cordis.patch.yml.before-gearbox-mount` — 挂载前的 desktop profile patch
- `profile-backups/desktop-cordis.patch.yml.before-double-mount-fix` — 修双重挂载前
- `profile-backups/desktop-restored-20260929/` — 原会话崩溃恢复后的状态快照

---

## 附：启用过程中暴露的四个问题（2026-09-29 03:2x，用户报"前端没有档位设置"）

### A. 插件被挂载两次 → 界面显示"异常"

症状（用户在 插件 页看到的弹窗）：

```
组件启用失败：1 entry did not activate gearbox (dsh-gearbox):
Error: service "gearbox" has been registered at <dsh-gearbox>
  at Proxy.provide (cordis/lib/index.js:801)
  at new apply (dsh-gearbox/lib/index.js:393)
```

两个挂载源：**① 插件管理器**在 profile patch 写了 `- id: gearbox / disabled: false`（用户点的开关）；
**② 我为免重启加的手写 `insert` 行**（id `gearbox-dev`）。

插件自带的 `!!js` 防双挂载守卫在这里**不可能生效**：bundle 层先组合，看不到之后 profile 层新增的行。
所以"profile 层再加一条"必然双挂载。

修法：删掉手写的 `insert` 行，只留 bundle 行 + 管理器开关。
另在插件里把 `ctx.provide` 包了 try/catch：真冲突时**让位并给出可诊断的警告**，而不是抛一个看不懂的错误。
（注意：**不要**用"注册表预检"来防重——HMR 重载时旧挂载可能仍在，预检会误判并让位，
旧挂载随后被销毁，插件就变成谁都没注册。这条弯路已走过一次。）

### B. 自动写入静默失败：`HMR transactions cannot be nested`

`configEditor.edit` 内部走 `hmr.runExclusive`，**不能嵌套**。而激活常常本身就是一次重载
（HMR / patch 文件刷新会重新应用该条目），所以从 `apply()` 里直接写必然失败：

```
lastApply: {"changed":false,"applied":[],"error":"HMR transactions cannot be nested"}
```

结果是**一条档位都没写进去**——这就是"前端没有档位设置"的直接原因。
修法：把写入**移出激活栈**（`setTimeout` 起步 250ms），并只针对这个错误做退避重试
（总窗口约 26s，覆盖 patch 重载持有的长事务）。现在 `lastApply.attempts` 会记录尝试次数。

### C. 改插件源码要重启 —— `dsh-hmr` 的 `root` 默认是空的

`dsh-base` 挂载 `dsh-hmr` 时 `root: []`，注释写得很清楚："Profile configuration reloads by default;
module roots are opt-in." 即**配置热重载默认开，模块热重载默认关**，改 `lib/*.js` 无效。

在 profile patch 里给它加上插件目录即可（必须是**真实开发路径**，不是 profile 的
`node_modules` junction —— `dsh-hmr` 默认忽略 `**/node_modules`）：

```yaml
- id: hmr
  name: "@deepseek-ai/dsh-hmr"
  config:
    root:
      - "D:/dsh_pludge/dsh-gearbox"
```

**已实测**：改 `lib/presets.js` 后运行中的实例立即读到新内容（用可回退的探针标记验证），无需重启。

### D. UJN 网关并发上限 = 5

`429 {"error":{"message":"并发请求数已达上限（5），请等待在途请求完成后再试"}}`

之前 `deepseek-v41-flash` 的非流式探针"全部超时"，真因是**槽位被占满**（多半是桌面应用自身的在途请求），
不是模型问题。教训：探测脚本要能区分超时与限流，且**不要在用户应用在用的时候猛打网关**。

### 本次写入的档位（三个模型，均已落到 `llm-pi-ai` 行）

| 模型 | 预设 | 对外档位 | 依据 |
|---|---|---|---|
| `GLM-5.3-Flash` | `glm-gateway` | off / high / xhigh / max | 实测（低于 high 该端点不思考） |
| `Qwen3.8-Flash-Next` | `openai-generic-effort` | off / minimal / low / medium / high / xhigh / max | 实测（整条阶梯有效） |
| `deepseek-v41-flash` | `deepseek-v4` | off / low / high / max | **目录推荐值，未实测**（探测时网关并发占满） |

**"前端能不能看到"的判据**：`GET /gears/api/inventory` 每行同时给出 `declared`（配置里写的）与
`advertised`（适配器实际对外提供的）。composer 渲染的是后者 —— 两者一致就说明选择器会出现。

---

## 附二：DSH 前端的三个设置面（读官方 client bundle 得出，2026-09-29 03:4x）

用户问"模型配置界面为什么没有自定义档位 / 图像模型为什么没有单独协议"。答案在三个不同的页面里。

### ① 设置 → 模型（`dsh-client-ui-settings-models`）

**字段是写死的子集**，不是 schema 驱动：

| 有 | 没有 |
|---|---|
| 提供商级：`API 协议`（3 选 1：OpenAI Responses / OpenAI Chat Completions / Anthropic Messages）、API 地址、API Key | 模型级协议（架构上不存在，见下） |
| 模型级：id、名称、上下文窗口、最大输出 token、输入类型（文本/图片） | **`reasoningEfforts` / `compat`（档位）** |

证据：该 bundle 里 `contextWindow` 出现 23 次、`maxTokens` 23 次，而 `reasoning` 只出现 **2 次**
——它基本不感知档位。所以"官方页没有档位"不是配置问题，是页面本身不含这个能力。

它提供的操作：`添加模型提供商`（新增一条路由）、`添加模型`、`获取可用模型`、`恢复默认模型`。

**插槽**：该页有 3 个 `renderSlot` 渲染点 —— `settings.models.provider-card`、
`settings.models.footer`、`settings.models.sign-in`。也就是说第三方**理论上可以**往官方模型页注入 UI
（需注册进 `@deepseek-ai/dsh-client-ui-slots` 并写 React 组件，插槽须由父级 children 表声明）。
这是"把档位编辑器做进官方页"的唯一可行路径，但需要渲染层组件，未做（见遗留问题 2）。

### ② 插件页 → 「配置 模型变速箱」

**这才是插件配置表单的入口**。`dsh-client-ui-plugin-manager` 里就有 `configForms` / `configureRow` /
`configForm`，文案是 **"配置 {name}"**、页面说明"安装、启用和配置插件"。它按插件的
schemastery `Config` 渲染表单 —— 所以 `applyMode` / `rules`（含预设下拉）/ `customEfforts` /
`customCompat` / Image Lane 全部在这里，**不需要插件自带任何 client UI**。

用户之前看不到它，是因为插件处于"异常"状态（双挂载）；修掉双挂载后该入口才会出现。

### ③ 架构约束：一个提供商一种协议

`api` 是**提供商（路由）级**字段（`providers.<route>.api`），不是模型级。所以：

- "给图像模型单独一个协议"在同一个路由内**做不到** —— 只能**新增一个提供商**把图像模型放进去。
- 而且必须做：`ujn` 是 `openai-responses`，网关实测直接拒绝图像模型 ——
  `400 "Qwen-Image-2.1 是图片生成模型，不支持 Responses API，请使用 /v1/images/generations 或 /v1/chat/completions"`。
- 更进一步：`Qwen-Image-2.1` 即使换到 `openai-completions` 也不能当聊天模型用
  —— DSH 对 assistant 图像输出直接抛 `UNSUPPORTED_CONTENT`。
  **这三个图像模型本来就不该出现在 `llm-pi-ai` 的模型列表里**：插件 Image Lane 用
  `image.providers.<name>.*` 里的模型 id 直接 fetch，**完全不依赖 `llm-pi-ai` 是否声明它们**。
- 图像生成的"单独协议"在插件里已经有了：`image.providers.<name>.style` ∈ `chat` / `images` / `siliconflow`，
  这是**每个 provider 一份**，比 `llm-pi-ai` 的路由级 `api` 更贴切（实测 `/chat/completions` 与
  `/images/generations` 两个端点可用，`/responses` 不可用）。

### 已落地：新增 `ujn-image` 提供商

按上面的约束给图像模型开了独立协议（等价于官方页的「添加模型提供商」）：

```yaml
      ujn-image:
        displayName: UJN（图像）
        apiKeyEnv: UJN_API_KEY
        api: openai-completions      # 不是 ujn 的 openai-responses
        baseURL: https://llm.ujn.edu.cn/v1
        models:
          - id: Qwen-Image-2.1      # input: [text] —— 见下方说明
          - id: Qwen-Image-PE-T2I   # input: [text]
          - id: Qwen-Image-PE-I2I   # input: [text, image]
```

顺带修掉一个真实缺陷：原先 `ujn` 路由上这两个增强模型声明的是 `input: [image]`，
**没有 `text`** —— 那会让 DSH 永远不把提示词发给它们。已在新提供商里补上。

`Qwen-Image-2.1` 即使协议正确也**不能当聊天模型**用（DSH 对 assistant 图像输出抛
`UNSUPPORTED_CONTENT`），出图请走插件的 Image Lane —— 它按 id 直接 fetch，不经过 `llm-pi-ai`。
保留它在列表里只是为了协议正确性。

隔离实例预检：无激活告警，`routes: ujn, ujn-image`，三条档位规则照常生效。

---

## 附三：Image Lane 重构为「供应商 / 模型 / 协议」三者解耦（2026-09-29 04:0x）

按用户给出的功能规格实现：多供应商、模型级协议绑定、三协议兼容、模型级档位（自动推荐+自定义）。

### 关键设计

协议从 **provider 级**搬到 **model 级**。原先 `image.providers.<name>.style` 是"整条 provider 一个风格"，
与"同一供应商下不同模型可选不同协议"直接冲突。新结构：

```yaml
image:
  providers:            # 只放连接事实
    ujn: { baseURL, apiKeyEnv, headers? }
  defaultProvider: ujn
  roles:                # 角色 → 模型 + 协议（各自独立）
    generator:      { provider, model, protocol: images-generations, size, gears{...}, gear }
    editor:         { provider, model, protocol: images-edits, maxInputImages: 4, imageField }
    promptEnhancer: { provider, model, protocol: chat }
    editEnhancer:   { provider, model, protocol: chat }
```

**向后兼容**：旧 provider 扁平字段（`style`/`generator`/`promptEnhancer`/`editEnhancer`/`size`）
由 `normalizeImage()` 自动折算成角色（`source: 'provider-flat'`），用户不必手改。
`roles` 存在时按角色覆盖。

### 档位 = 具名的请求体字段包

规格要求"每个模型可配置可用档位集合，调用时自动带入接口参数"。实现为：

```yaml
gears:
  standard: { size: "1024x1024", n: 1 }
  wide:     { size: "1280x720",  n: 1 }
gear: standard
```

插件**不发明字段名** —— gear 里的键原样合入请求体（JSON 角色合顶层，multipart 角色走表单字段）。
工具参数 `gear` / 命令 `--gear` / HTTP 路由 `{"gear":...}` 均可按次覆盖。
chat 角色同理可用作思考档位：`gears.deep: { reasoning_effort: "high" }`。

### 新增 `images-edits`（multipart）

`POST /v1/images/edits`，`FormData` 上传，上限 `maxInputImages`（默认 4）。
**刻意不手写 `Content-Type`**：boundary 必须由 `fetch` 自己写，手设会让服务端无法解析。
上传字段名可配（`imageField`，部分端点要求 `image[]`）。

### 验证

- `scripts/harness.mjs` 新增协议矩阵：两供应商 + 一供应商三模型三协议；
  逐条断言请求形状（(a) JSON 体含档位字段与 role size、(b) 真 multipart 到 `/images/edits` 且文件数正确、
  (b2) `maxInputImages` 生效、(c) 增强器走**另一个供应商**且其档位进请求体、(d) 按次档位覆盖），
  外加 6 种返回形状解析与旧格式兼容。
- 真实运行时（隔离实例）：新格式经 HMR 生效，`lane.roles` 显示
  `generator→images-generations(gears=[standard,wide])`、`editor→images-edits`、两个增强器 `→chat`。
- 真实出图冒烟仍 502（`Stage-0 has no live replica`）——上游故障未恢复，插件侧路径已通。

### 遗留

- `editor` 角色暂绑 `Qwen-Image-2.1`（该网关未单独公布编辑模型）。若 `/v1/images/edits` 拒绝它，
  错误信息会点名模型，换一个绑定即可。
- 档位里的 `size` 取值（1024x1024 / 1280x720）未实测——上游图像后端不可用期间无法验证哪些尺寸被接受。

---

## 附四：设置界面 —— 为什么没有，以及最后的方案（2026-09-29 04:1x）

用户在插件页找不到配置入口。读了 `dsh-client-ui-plugin-manager` 的 client bundle，机制是：

```
configure.has(row)  ===  configLedger.rows.has(rowConfigKey(pkg.name, row.rowId))
formFor(id)         ===  configurations.some(view => view.ns === id) ? configForms.get(id) : undefined
configForms         ←── this.ctx.remote.settings.describe()      ← Host RPC
```

即：**「配置 {name}」入口来自插件管理器的 config ledger，表单数据来自 Host 的 settings RPC**。
这两条链路都不受第三方插件控制 —— 所以"第三方插件的 Config 会自动渲染成表单"这个假设不成立，
之前指给用户的入口确实可能不出现。

### 方案取舍

| 方案 | 结论 |
|---|---|
| 依赖插件管理器的 configForm | 不可控（ledger + Host RPC），放弃作为唯一途径 |
| 注册进 `settings.models.provider-card` 插槽 | 需渲染层 React 组件 + 父级 children 表声明，盲写风险高 |
| **插件自带设置页（已做）** | 完全可控、可验证、不会拖垮渲染层 |

### 已落地：`GET /gears/ui`

一个自包含 HTML 页（内联 CSS+JS，无外部资源），走与 `/gears/api/*` 相同的 origin 与鉴权。
**它显示的是运行中的真实状态**，这是一般 schema 表单给不了的：

1. **状态卡**：预设数 / 协议 / 路由 / 规则数与 applyMode / 图像协议，以及
   `lastApply` 的完整真相 —— 时间、来源、尝试次数、错误、被拒原因、协议适配说明
2. **档位矩阵**（核心）：每条路由 × 每个模型，并排显示
   **配置的档位** vs **前端实际可用的档位**（后者是 composer 渲染选择器的依据，两者不一致标红）
3. 每个模型的**推荐预设下拉**（按协议匹配的排前面，不匹配的单独分组标出）→ 一键「应用预设」
4. 每个模型的**自定义档位 JSON 编辑器** → 「应用自定义」
5. Image Lane：供应商（baseURL + 凭据引用名，不显示凭据本体）、四个角色的 provider/model/protocol/gears

设计上的实用性与便捷性权衡：

- **可见即真相**：直接读 `inventory` 的 `advertised`，不转述配置文件 —— 用户不需要知道
  "配置写进去了但适配器没认"这种中间态
- **一键路径**：选预设 → 应用 → 自动重拉 inventory，看到 advertised 变化，闭环在页面内完成
- **降险**：纯 HTML 页在独立路由上，坏了也不影响 DSH 渲染层（对比：client bundle 一条语法错误曾清空 profile）

### 实现里踩到并修掉的坑

`/gears/ui` 的内联脚本是从模板字面量插值出来的，`node --check` 查模块文件查不出它的问题。
一个 `placeholder='...'`（单引号 HTML 属性套单引号 JS 字符串，外层模板字面量还会吃掉转义符）
让页面脚本整个语法错误 —— **浏览器里表现为白屏，本地毫无感知**。
已在验证台加了常驻守卫：**取出服务后的 `<script>` 用 `new Function` 编译**，这类错误从此在秒级暴露。

---

## 附五：接进 DSH 设置界面（`settings.section` 插槽）—— 2026-09-29 04:3x

用户要求：像 `dsh-better-sidebar` 的「侧边卡片」那样，**在 DSH 设置里有一个自己的分节**，点进去详细配置。

### 读出来的契约

`dsh-better-sidebar` 的 `dsh.client.inject` **没有** `dsh-client-ui-settings`，它注入的是
`@deepseek-ai/dsh-client-ui-slots` 等包 id。它的注册调用（源码里直接读到）：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "better-sidebar",
  order: 100,
  label: () => t("settingsNav"),          // 设置导航里的名字
  inject: () => ({ store, service })       // 传给组件的 props
}, SideCardSection));                       // React 组件
```

- 设置分节靠 **`settings.section` 插槽**，不是 settings namespace（那条要 Host RPC，不可控）
- DSH 0.1.x 只投射 `id` / `order` / `label` 三个字段
- 客户端拿 React 的方式：`factory(require)` 里的 `require("react")`（模块表预置了
  React / react-dom / react/jsx-runtime / ui-primitives），无 JSX 变换，只能用 `createElement`

### 采用方案：分节 = 一个指向 `/gears/ui` 的 iframe

`lib/client.js` 注册 `settings.section`（id `dsh-gearbox`，order 120，label 走本地化），
组件渲染**插件自己的 `/gears/ui` 页面**。

选 iframe 而不是重写一份 React UI，理由是**隔离**：页面是独立文档，里面的运行时错误碰不到设置外壳，
更碰不到渲染层 —— 正是曾经清空过 profile 的那条失败路径。两边也不会漂移，因为只有一份实现。

组件另带「在新标签打开」链接，万一外壳限制了内嵌（CSP/框架策略）仍有出口。

同时给 `/gears/ui` 加了主题适配：分节通过 `?theme=` 传入外壳主题，独立访问时回退 `prefers-color-scheme`，
用 `data-theme` 属性切深色覆盖，避免深色外壳里出现白面板。

### 验证（`scripts/harness.mjs`）

客户端半的检查从"只验证可加载"升级为**行为验证**：

- 注入 `require` 桩返回 React 桩、mock `ctx.slots` / `ctx.effect` / `ctx.locale`
- 断言注册进的是 `settings.section`、id/order/label 合法、label 解析出「模型变速箱」
- **真的调用组件函数**并断言它不抛、且引用了 `/gears/ui`
  —— 渲染期错误在真实应用里表现为"分节空白"，这一步让它在本地就暴露
- 页面检查同样升级：编译**全部**内联脚本（主题初始化 + 页面脚本），并断言存在 `data-theme` 钩子

### 生效条件（重要）

客户端 bundle 是**渲染层启动时拉取**的，`dsh-hmr` 的模块监听只管宿主进程。
所以客户端半的改动**需要重载窗口（Ctrl+R）或重启应用**才生效 —— 宿主半的改动不需要。
