/**
 * dsh-gearbox Config schema (schemastery). The DSH settings shell renders this
 * — the plugin manager's "配置 <name>" form — so **this file is the settings
 * panel**: every choice the UI offers is declared here rather than described in
 * prose, and `z.union([...])` fields render as pickers that reject a typo at
 * save time instead of writing a config that silently does nothing.
 *
 * Adding a preset to `lib/presets.js` extends the preset picker automatically.
 *
 * Import resolution: `@deepseek-ai/schemastery` resolves through the Host's
 * runtime module resolution (the installation-scope dependency closure), the
 * same mechanism dsh-better-sidebar uses.
 */
import z from '@deepseek-ai/schemastery';
import { PRESETS, THINKING_FORMATS, THINKING_LEVELS } from './presets.js';
import { IMAGE_PROTOCOLS, IMAGE_BODY_STYLES, IMAGE_ROLES } from './image-lane.js';

const presetIds = PRESETS.map((preset) => preset.id);
const presetLegend = PRESETS.map((preset) => `${preset.id} = ${preset.label}`).join('；');

// ---------------------------------------------------------------- Effort Studio

/** A single Effort Studio rule: preset-driven or fully custom. */
const rule = z.object({
  route: z.string().description('llm-pi-ai 路由名（providers 字典的键，如 ujn）').required(),
  model: z.string().description('模型 id，须与 models[].id 或网关模型名一致').required(),
  preset: z.union(presetIds).description(`内置预设 id。可选：${presetLegend}`),
});

/**
 * Explicit gear -> wire-value overrides. A key present with a string value is
 * sent as-is; a key present with `null` means "supported, but send no field"
 * and is legal for `off` only.
 */
const customEfforts = z.dict(z.union([z.string(), z.const(null)]))
  .description(`自定义档位映射（${THINKING_LEVELS.join(' / ')}）；值 null 仅 off 合法，其余档位请直接省略该键`);

const customCompat = z.object({
  thinkingFormat: z.union([...THINKING_FORMATS])
    .description('自定义 thinkingFormat（与预设二选一）。注意：路由 api 为 openai-responses 时不接受该开关，插件会自动丢弃并给出提示'),
}).description('自定义 compat（与 preset 二选一）');

// ------------------------------------------------------------------ Image Lane

/**
 * A named gear: "when this model is called at this gear, merge these fields
 * into the request body".
 *
 * The keys are the wire fields the endpoint expects, because only the user
 * knows them — we deliberately do not invent parameter names. For a chat-role
 * model that is typically `reasoning_effort`; for an image model it is
 * `size` / `n` / `quality` / whatever the endpoint documents.
 */
const imageGear = z.dict(z.union([z.string(), z.number(), z.boolean()]))
  .description('档位：要合并进请求体的字段，如 { size: "1024x1024", n: 1 } 或 { reasoning_effort: "high" }');

/**
 * One role's model binding: **provider + model + protocol, bound together**.
 *
 * The protocol lives here rather than on the provider on purpose. A provider is
 * only connection facts (base URL + credential); which endpoint a call goes to
 * is a property of the *model*, so one provider can serve a text→image model on
 * `/images/generations`, an edit model on `/images/edits` and a prompt
 * enhancer on `/chat/completions` at the same time.
 */
const imageRole = z.object({
  provider: z.string().description('供应商标识（providers 字典的键）；留空则用 image.defaultProvider'),
  model: z.string().description('模型 id，作为请求体的 model 字段原样发送').required(),
  protocol: z.union([...IMAGE_PROTOCOLS]).description(
    '通信协议：images-generations = POST /v1/images/generations（文生图，JSON，返回 data[0].b64_json）；'
    + 'images-edits = POST /v1/images/edits（图片编辑，multipart，最多 4 张输入图）；'
    + 'chat = POST /v1/chat/completions（提示词增强，返回 JSON 文本）',
  ),
  gears: z.dict(imageGear).description('该模型可用的档位集合：档位名 → 要合并进请求体的字段'),
  gear: z.string().description('当前选定档位名（须是 gears 里的键）；留空则不加任何档位参数'),
  size: z.string().description('尺寸，如 1024x1024（images-generations / images-edits 用）'),
  bodyStyle: z.union([...IMAGE_BODY_STYLES]).description(
    '仅 images-generations：openai = { size, n }；siliconflow = { image_size, batch_size }',
  ),
  imageField: z.string().description('仅 images-edits：上传文件的表单字段名，默认 image；部分端点要求 image[]'),
  maxInputImages: z.number().description('仅 images-edits：最多接受几张输入图，默认 4'),
  timeoutMs: z.number().description('该角色的请求超时（毫秒）；留空表示不设上限（图像生成本来就慢）'),
});

export const Config = z.object({
  // -- Effort Studio (text models) --
  rules: z.array(rule).description('档位规则：applyMode=auto 时保存即直写 llm-pi-ai。不改写则模型没有档位行，前端也不会出现档位选择器'),
  customEfforts: z.array(z.intersect([rule, customEfforts])).description('完全自定义档位的规则（与 preset 二选一）'),
  customCompat: z.array(z.intersect([rule, customCompat])).description('自定义 compat 的规则'),
  applyMode: z.union(['auto', 'manual'])
    .description('auto=保存即直写 llm-pi-ai 配置（写入前本地校验，不合法规则单独拒绝而不拖垮整次保存）；manual=仅在 /gears/api/apply 或导出 YAML 后生效'),

  // -- Image Lane --
  image: z.object({
    providers: z.dict(z.object({
      baseURL: z.string().description('OpenAI 兼容根地址，如 https://llm.example.com/v1').required(),
      apiKeyEnv: z.string().description('凭据引用（DSH 凭据存储的键或环境变量名）').required(),
      headers: z.dict(z.string()).description('附加请求头（可选）'),
      displayName: z.string().description('显示名（可选）'),
      // Legacy role fields. Kept so an existing config keeps working; when
      // `roles` is present these are ignored.
      style: z.union(['chat', 'images', 'siliconflow']).description('旧字段：整条 provider 一个 style。新配置请改用 image.roles 里的 protocol'),
      generator: z.string().description('旧字段：生成模型 id'),
      promptEnhancer: z.string().description('旧字段：文生图提示词增强模型 id'),
      editEnhancer: z.string().description('旧字段：编辑指令改写模型 id'),
      size: z.string().description('旧字段：默认尺寸'),
    })).description('供应商：只放连接与凭据；协议绑定在 image.roles 的每个模型上'),

    defaultProvider: z.string().description('默认供应商名（roles 里留空 provider 时使用）'),

    roles: z.dict(imageRole).description(
      `角色 → 模型绑定，可自由组合：${IMAGE_ROLES.map((role) => `${role.id}=${role.label}`).join('；')}。`
      + '同一供应商下不同模型可选不同协议；不同供应商可自由选同一协议',
    ),

    saveDir: z.string().description('会话工作区内的保存目录').default('.dsh-gearbox'),
    autoEnhance: z.boolean().description('生成前自动调用对应增强模型（PE-T2I / PE-I2I）').default(true),
  }).description('Image Lane 图像生成通道'),
});

export default Config;
