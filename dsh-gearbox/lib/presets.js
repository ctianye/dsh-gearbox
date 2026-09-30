/**
 * dsh-gearbox built-in reasoning-effort presets.
 *
 * Every entry is transcribed from the pi-ai 0.85.1 provider catalog shipped
 * inside DSH 0.2.0-rc.1 — the same data dsh-llm-pi-ai itself dispatches
 * through. `levels` is a thinkingLevelMap: keys are the seven logical gears
 * (off, minimal, low, medium, high, xhigh, max), values are the wire
 * spellings dispatch sends, and `null` declares a level unsupported (hidden
 * in the UI).
 *
 * A preset also carries the wire-format knowledge: `api` is the route
 * protocol dsh-llm-pi-ai must be configured with, `thinkingFormat` is the
 * compat switch selecting which request fields carry the effort, and
 * `budgetField` names the reasoning-token budget parameter when the endpoint
 * accepts one. `matches` are model-id globs the preset applies to, and
 * `note`/`noteEn` render in the settings surface so the user can see at a
 * glance which models a preset serves.
 */

/**
 * @typedef {Object} GearPreset
 * @property {string} id
 * @property {string} label        display name (zh)
 * @property {string} labelEn
 * @property {string} note         applicability + caveats (zh)
 * @property {string} noteEn
 * @property {string} api          openai-completions | openai-responses | anthropic-messages
 * @property {string} [thinkingFormat]
 * @property {boolean} [adaptive]  anthropic adaptive thinking (output_config.effort)
 * @property {string} [budgetField]  reasoning-token-budget parameter name
 * @property {Record<string, string|null>} levels  gear -> wire spelling; `null` = endpoint has no such gear (dropped from the emitted dict, except for `off`, where it means "turn thinking off by sending no field")
 * @property {Record<string, number>} [budgets]  gear -> token budget (route level)
 * @property {string[]} matches    model-id globs
 */

/** @type {GearPreset[]} */
export const PRESETS = [
  {
    id: 'openai-gpt5',
    label: 'OpenAI GPT-5 系（新版）',
    labelEn: 'OpenAI GPT-5 family (current)',
    note: '适用：gpt-5.1 及以后 / o3 / o4。走 Responses API（reasoning:{effort}）。gpt-5.1 起 off 映射为 "none"；gpt-5.2+ 增加 xhigh；gpt-5.6+ 增加 max。',
    noteEn: 'Fits gpt-5.1+ / o3 / o4 via the Responses API (reasoning:{effort}). off maps to "none" since 5.1; xhigh since 5.2; max since 5.6.',
    api: 'openai-responses',
    levels: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    matches: ['gpt-5.1*', 'gpt-5.2*', 'gpt-5.3*', 'gpt-5.4*', 'gpt-5.5*', 'gpt-5.6*', 'o3*', 'o4*'],
  },
  {
    id: 'openai-gpt5-base',
    label: 'OpenAI GPT-5 初代',
    labelEn: 'OpenAI GPT-5 (base)',
    note: '适用：gpt-5 / 5-mini / 5-nano 初代，无 xhigh/max；off 不发送任何字段。',
    noteEn: 'Original gpt-5 tier: no xhigh/max; off sends no field.',
    api: 'openai-responses',
    levels: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    matches: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-pro'],
  },
  {
    id: 'deepseek-v4',
    label: 'DeepSeek V4 系',
    labelEn: 'DeepSeek V4 family',
    note: '适用：deepseek-v4-flash / v4-pro（官方端点）。thinking:{type:enabled} 开关 + reasoning_effort，档位 low/high/max。v3.2 及更早无级差。',
    noteEn: 'Fits deepseek-v4-flash/pro on official endpoints: thinking:{type} toggle + reasoning_effort with low/high/max. v3.2 and earlier have no levels.',
    api: 'openai-completions',
    thinkingFormat: 'deepseek',
    levels: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    matches: ['deepseek-v4*', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'glm-zai',
    label: '智谱 GLM（z.ai 官方端点）',
    labelEn: 'Zhipu GLM (z.ai endpoint)',
    note: '适用：glm-4.7 / glm-5.x 走 z.ai 官方端点。thinking:{type} 仅开/关，无真实级差；选择 low~max 效果相同（都发 reasoning_effort），off 关闭思考。',
    noteEn: 'Fits glm-4.7/glm-5.x on the z.ai endpoint. thinking:{type} is an on/off switch only; low..max all send the same token, off disables thinking.',
    api: 'openai-completions',
    thinkingFormat: 'zai',
    // Toggle-only endpoint: pi-ai sends thinking:{type:enabled} + reasoning_effort
    // from the map. Declaring all gears null would fail dsh-llm-pi-ai validation
    // ("no level beyond off"), so one gear carries the wire token the endpoint accepts.
    levels: { off: null, minimal: null, low: null, medium: null, high: 'enabled', xhigh: null, max: null },
    matches: ['glm-4*', 'glm-5*'],
  },
  {
    id: 'glm-gateway',
    label: '智谱 GLM（经网关，支持 effort）',
    labelEn: 'Zhipu GLM (via gateway with effort)',
    note: '适用：glm-5.x 经真实转发 reasoning_effort 的网关。档位 high/xhigh/max —— 实测（UJN 网关）high 起才真正产生思考，minimal/low/medium 该端点接受但思考量为 0，故不列出以免 UI 误导。请用 scripts/probe-endpoint.mjs 对你自己的网关核实后再定档。',
    noteEn: 'Fits glm-5.x behind a gateway that genuinely forwards reasoning_effort. Levels high/xhigh/max — measured against a live gateway, everything below `high` is accepted but produces zero reasoning, so those gears are omitted rather than shown as no-ops. Verify your own gateway with scripts/probe-endpoint.mjs.',
    api: 'openai-completions',
    thinkingFormat: 'qwen',
    levels: { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: 'xhigh', max: 'max' },
    matches: ['glm-5*'],
  },
  {
    id: 'qwen38',
    label: '通义 Qwen3.8 系',
    labelEn: 'Qwen Qwen3.8 family',
    note: '适用：qwen3.8-flash / qwen3.8-max。enable_thinking 开关 + reasoning_effort，档位 low/medium/xhigh —— 注意没有 high 档！',
    noteEn: 'Fits qwen3.8-flash/max: enable_thinking toggle + reasoning_effort with low/medium/xhigh — note there is NO high gear.',
    api: 'openai-completions',
    thinkingFormat: 'qwen',
    levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: null, xhigh: 'xhigh', max: null },
    matches: ['qwen3.8*'],
  },
  {
    id: 'qwen36',
    label: '通义 Qwen3.6/3.7 系',
    labelEn: 'Qwen Qwen3.6/3.7 family',
    note: '适用：qwen3.6-plus/flash、qwen3.7-plus/max。仅 enable_thinking 开/关，无级差字段；low~max 任选一档即"开"。',
    noteEn: 'Fits qwen3.6/3.7 models: enable_thinking on/off only; any level means "on".',
    api: 'openai-completions',
    thinkingFormat: 'qwen',
    levels: { off: null, minimal: null, low: null, medium: null, high: 'on', xhigh: null, max: null },
    matches: ['qwen3.6*', 'qwen3.7*'],
  },
  {
    id: 'kimi-k2',
    label: 'Kimi K2 系（思考开关）',
    labelEn: 'Kimi K2 family (thinking toggle)',
    note: '适用：kimi-k2* / kimi-k2.5 / kimi-k2.6。thinking:{type} 开/关，无级差；low~max 任选一档即"开"。kimi-k3 起支持档位，见 kimi-k3 预设。',
    noteEn: 'Fits kimi-k2*: thinking:{type} toggle only; any level means "on". kimi-k3 and later support levels (see kimi-k3 preset).',
    api: 'openai-completions',
    thinkingFormat: 'deepseek',
    levels: { off: null, minimal: null, low: null, medium: null, high: 'on', xhigh: null, max: null },
    matches: ['kimi-k2*', 'kimi-latest'],
  },
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    labelEn: 'Kimi K3',
    note: '适用：kimi-k3。reasoning_effort 档位 low/high/max。',
    noteEn: 'Fits kimi-k3: reasoning_effort with low/high/max.',
    api: 'openai-completions',
    thinkingFormat: 'openai',
    levels: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    matches: ['kimi-k3*'],
  },
  {
    id: 'claude-adaptive',
    label: 'Claude 4.7+（自适应思考）',
    labelEn: 'Claude 4.7+ (adaptive thinking)',
    note: '适用：claude-opus-4.7/4.8/5、claude-sonnet-5。thinking:{type:adaptive} + output_config.effort，档位 xhigh/max。需要官方 anthropic-messages 协议。',
    noteEn: 'Fits claude-opus-4.7/4.8/5 and claude-sonnet-5: thinking:{type:adaptive} + output_config.effort with xhigh/max. Requires the native anthropic-messages protocol.',
    api: 'anthropic-messages',
    adaptive: true,
    levels: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: 'xhigh', max: 'max' },
    matches: ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5*', 'claude-sonnet-5*', 'claude-fable-*'],
  },
  {
    id: 'claude-budget',
    label: 'Claude 4.x（预算思考）',
    labelEn: 'Claude 4.x (budget thinking)',
    note: '适用：claude-sonnet-4.x / opus-4.x（4.6 及更早）。thinking:{type:enabled, budget_tokens:N}，档位映射为 token 预算 1024/8192/16384（可在规则里覆盖）。',
    noteEn: 'Fits claude-sonnet-4.x / opus-4.x (4.6 and earlier): thinking:{type:enabled, budget_tokens:N}; gears map to budgets 1024/8192/16384 (overridable per rule).',
    api: 'anthropic-messages',
    levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    budgets: { low: 1024, medium: 8192, high: 16384 },
    matches: ['claude-3*', 'claude-sonnet-4*', 'claude-opus-4*'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    labelEn: 'Google Gemini',
    note: '适用：gemini-2.5/3.x。Gemini 3 系走 thinkingLevel（pro 仅 LOW/HIGH）；2.5 系走 thinkingBudget 数字（pro 128/2048/8192/32768）。经 OpenAI 兼容网关时字段由网关翻译。',
    noteEn: 'Fits gemini-2.5/3.x. Gemini 3 uses thinkingLevel (pro: LOW/HIGH only); 2.5 uses numeric thinkingBudget. Field translation depends on the gateway.',
    api: 'openai-completions',
    thinkingFormat: 'openai',
    levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    matches: ['gemini-*'],
  },
  {
    id: 'grok',
    label: 'xAI Grok',
    labelEn: 'xAI Grok',
    note: '适用：grok-4.5/4.6（Responses API）。off 映射 "none"，档位 low..xhigh（4.5 无 xhigh）。grok-3-mini 仅 low/high。',
    noteEn: 'Fits grok-4.5/4.6 via Responses API: off maps to "none", levels low..xhigh (4.5 lacks xhigh). grok-3-mini: low/high only.',
    api: 'openai-responses',
    levels: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
    matches: ['grok-*'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter 统一路由',
    labelEn: 'OpenRouter unified routing',
    note: '适用：openrouter 上任意模型（前缀 vendor/model）。reasoning:{effort} 统一字段，off 映射 "none"。档位以 OpenRouter 模型页标注为准。',
    noteEn: 'Fits any OpenRouter model (vendor/model prefix). reasoning:{effort} unified field; off maps to "none". Levels follow the model page.',
    api: 'openai-completions',
    thinkingFormat: 'openrouter',
    levels: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    matches: ['*/*'],
  },
  {
    id: 'openai-generic-effort',
    label: '通用 OpenAI 兼容（reasoning_effort）',
    labelEn: 'Generic OpenAI-compatible (reasoning_effort)',
    note: '适用：任何接受 reasoning_effort 字段的 OpenAI 兼容端点（vLLM/SGLang/各类中转/Responses 网关）。档位原样透传，适合作自定义起点。**经实测确认端点会校验并响应整条档位阶梯时，这是最准确的选择**——原生厂商预设（zai/qwen/deepseek）描述的是各自端点的开关语义，套到网关上会偏保守。',
    noteEn: 'Fits any OpenAI-compatible endpoint accepting reasoning_effort (vLLM/SGLang/proxies/Responses gateways). Levels pass through verbatim; a good custom starting point, and the most accurate choice once you have measured that the endpoint validates and acts on the whole ladder — the native vendor presets describe their own endpoint\'s toggle semantics and will under-offer on a gateway.',
    api: 'openai-completions',
    thinkingFormat: 'openai',
    levels: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    matches: [],
  },
  {
    id: 'openai-generic-budget',
    label: '通用思考预算（thinking_budget）',
    labelEn: 'Generic budget (thinking_budget)',
    note: '适用：vLLM/SGLang 等自托管端点。档位映射为 thinking_token_budget 数字（默认 1024/2048/8192/16384，可覆盖）；也支持 thinking_budget / thinking_budget_tokens 字段名。',
    noteEn: 'Fits self-hosted vLLM/SGLang endpoints. Gears map to numeric thinking_token_budget (defaults 1024/2048/8192/16384, overridable); also accepts thinking_budget / thinking_budget_tokens.',
    api: 'openai-completions',
    thinkingFormat: 'openai',
    budgetField: 'thinking_token_budget',
    levels: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    budgets: { minimal: 1024, low: 2048, medium: 8192, high: 16384 },
    matches: [],
  },
];

/** Logical gears in escalation order — mirrors pi-ai's THINKING_LEVELS. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The reasoning-dispatch wire formats a profile may name, transcribed from
 * dsh-llm-pi-ai's `SUPPORTED_THINKING_FORMATS`. Only `openai-completions`
 * carries this switch at all.
 */
export const THINKING_FORMATS = [
  'openai', 'deepseek', 'openrouter', 'together', 'baseten', 'zai', 'qwen',
  'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling',
];

/** @returns {GearPreset|undefined} */
export function presetById(id) {
  return PRESETS.find((preset) => preset.id === id);
}

/** The three wire protocols a profile may configure. */
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];

/**
 * The `compat` switches each wire protocol accepts, transcribed from
 * dsh-llm-pi-ai's `COMPAT_GATES` (only the `offer` disposition — `withhold`
 * fields are not settable from a profile, and naming one is refused too).
 *
 * This table exists because a **model-level** compat switch its protocol does
 * not take fails resolution outright:
 *
 *   `model "X" sets compat "thinkingFormat", but its api is "openai-responses",
 *    which does not take it; that switch exists on openai-completions, and
 *    "openai-responses" offers supportsDeveloperRole, supportsMaxOutputTokens,
 *    supportsStrictMode, supportsLongCacheRetention`
 *
 * and `INVALID_CONFIG` discards the entire config save, not just that row. The
 * most common instance is a real one: a gateway route declared
 * `openai-responses` cannot carry `thinkingFormat: "zai"`, however well the
 * endpoint behind it understands GLM.
 */
export const PROTOCOL_COMPAT_FIELDS = {
  'openai-completions': new Set([
    'supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming',
    'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult',
    'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat',
    'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField',
    'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention',
  ]),
  'openai-responses': new Set([
    'supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention',
  ]),
  'anthropic-messages': new Set([
    'supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools',
    'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools',
  ]),
};

/**
 * Wire spellings the Responses protocol can carry as `reasoning.effort`.
 *
 * The toggle-style presets (`zai`, `qwen`, `deepseek` on their own endpoints)
 * express "thinking on" as `enabled` / `on` — a format-specific token that is
 * meaningless as an `effort`. When such a preset lands on a Responses route the
 * gears survive the write but the endpoint may not understand them, so the
 * outcome is reported as an adaptation rather than passing silently.
 */
const RESPONSES_EFFORT_WIRES = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Fit a model-entry fragment to the protocol its route actually speaks.
 *
 * Only `openai-completions` carries the thinking-format switches, so a preset
 * aimed at a native vendor endpoint keeps its gears but sheds the compat keys a
 * gateway route would reject.
 *
 * @param {object} fragments - output of {@link presetToFragments}
 * @param {string} api - the route's configured protocol
 * @returns `{ fragments, droppedCompat, suspiciousGears }`
 */
export function adaptToProtocol(fragments, api) {
  const allowed = PROTOCOL_COMPAT_FIELDS[api];
  const droppedCompat = [];
  const suspiciousGears = [];
  /** Drop an emptied `compat` key rather than writing `compat: {}` into the profile. */
  const withoutEmptyCompat = (adapted) => {
    const { compat, ...rest } = adapted;
    return Object.keys(compat ?? {}).length === 0 ? rest : { ...rest, compat };
  };
  if (allowed === undefined) {
    // An unknown protocol takes no compat at all.
    return {
      fragments: withoutEmptyCompat({ ...fragments, compat: {} }),
      droppedCompat: Object.keys(fragments.compat ?? {}),
      suspiciousGears,
    };
  }
  const compat = {};
  for (const [field, value] of Object.entries(fragments.compat ?? {})) {
    if (allowed.has(field)) compat[field] = value;
    else droppedCompat.push(field);
  }
  if (api === 'openai-responses') {
    for (const [gear, wire] of Object.entries(fragments.reasoningEfforts ?? {})) {
      if (typeof wire === 'string' && !RESPONSES_EFFORT_WIRES.has(wire)) suspiciousGears.push(`${gear}:"${wire}"`);
    }
  }
  return { fragments: withoutEmptyCompat({ ...fragments, compat }), droppedCompat, suspiciousGears };
}

/** Protocol-mismatch notes explaining what a write could not carry as declared. */
export function protocolNotes(preset, api, route) {
  if (api === undefined || preset.api === api) return [];
  return [`preset "${preset.id}" targets ${preset.api}, but route "${route}" is ${api}`];
}

/** Presets whose `matches` globs hit the model id (simple * glob, case-insensitive). */
export function presetsForModel(modelId, api) {
  const hit = (glob) => {
    const re = new RegExp('^' + glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return re.test(modelId);
  };
  const matched = PRESETS.filter((preset) => preset.matches.some(hit));
  if (api === undefined) return matched;
  // A preset whose endpoint protocol matches the route needs no adaptation at
  // all, so it leads. Both halves keep library order.
  return [...matched.filter((preset) => preset.api === api), ...matched.filter((preset) => preset.api !== api)];
}

/** Whether a preset applies to a route without any protocol adaptation. */
export function presetFitsRoute(preset, api) {
  return api === undefined || preset.api === api;
}

/**
 * Translate a preset into the dsh-llm-pi-ai **model-entry** fragments.
 * Returns `{ reasoningEfforts, compat }` — exactly the fields a `models[]`
 * entry (or a `modelOverrides` value) accepts.
 *
 * `overrides.efforts` lets a rule re-declare individual gears; `overrides.compat`
 * merges compat switches.
 *
 * ## Why nulls are dropped
 *
 * dsh-llm-pi-ai's own admission rule (`resolveModelReasoning`) rejects a
 * valueless key for every level **except `off`**:
 *
 *   "reasoningEfforts.<level> needs the wire value dispatch should send;
 *    only `off` may leave it empty"
 *
 * It pins an *omitted* level to `null` in the resulting thinkingLevelMap, so
 * omitting is how "this endpoint has no such gear" is expressed. Emitting
 * `high: null` — the naive translation of a preset table, and what this
 * function used to do — fails admission and takes the whole config save with
 * it. Only `off` keeps a valueless key, where it means "thinking can be turned
 * off, and dispatch sends no field to do it".
 */
export function presetToFragments(preset, overrides = {}) {
  const levels = { ...preset.levels, ...(overrides.efforts ?? {}) };
  const reasoningEfforts = {};
  for (const level of THINKING_LEVELS) {
    if (!(level in levels)) continue;
    const wire = levels[level];
    if (wire === null) {
      if (level === 'off') reasoningEfforts.off = null;
      continue;
    }
    reasoningEfforts[level] = wire;
  }
  const compat = {};
  if (preset.thinkingFormat) compat.thinkingFormat = preset.thinkingFormat;
  if (preset.adaptive) compat.forceAdaptiveThinking = true;
  if (preset.budgetField) {
    compat.supportsThinkingTokenBudget = true;
    compat.thinkingTokenBudgetField = preset.budgetField;
  }
  Object.assign(compat, overrides.compat ?? {});
  return { reasoningEfforts, compat };
}

/**
 * Translate a preset into the **route-level** fragments its gears need.
 *
 * `thinkingBudgets` lives on the provider profile, not on a model entry, so it
 * travels separately: writing it inside a `models[]` row would be rejected by
 * the profile schema. Only presets that name budgets produce anything.
 */
export function presetToRouteFragments(preset, overrides = {}) {
  const budgets = { ...(preset.budgets ?? {}), ...(overrides.budgets ?? {}) };
  return Object.keys(budgets).length > 0 ? { thinkingBudgets: budgets } : {};
}

/**
 * Mirror of dsh-llm-pi-ai's `resolveModelReasoning` admission rules.
 *
 * Running it before a write keeps one bad rule from failing the entire config
 * save: `INVALID_CONFIG` rejects the whole `config`, not just the offending
 * model. The wording matches the adapter's diagnostics so a user who hits the
 * same check later sees the same sentence.
 *
 * @returns violation strings; empty means the adapter would accept the row.
 */
export function reasoningEffortsProblems(modelId, efforts) {
  const problems = [];
  if (efforts === undefined || efforts === false) return problems;
  if (efforts === null || typeof efforts !== 'object') {
    problems.push(`model "${modelId}" has an empty reasoningEfforts; declare the offered levels, set false for a non-reasoning model, or omit the field to keep the installed catalog's capability`);
    return problems;
  }
  const declared = THINKING_LEVELS.filter((level) => level in efforts);
  if (declared.length === 0) {
    problems.push(`model "${modelId}" has an empty reasoningEfforts; declare the offered levels, set false for a non-reasoning model, or omit the field to keep the installed catalog's capability`);
    return problems;
  }
  for (const level of declared) {
    const wire = efforts[level];
    if (wire === null) {
      if (level !== 'off') {
        problems.push(`model "${modelId}" reasoningEfforts.${level} needs the wire value dispatch should send; only "off" may leave it empty`);
      }
    } else if (typeof wire !== 'string' || wire.length === 0) {
      problems.push(`model "${modelId}" reasoningEfforts.${level} must not be an empty string`);
    }
  }
  if (!declared.some((level) => level !== 'off')) {
    problems.push(`model "${modelId}" reasoningEfforts offers no level beyond "off"; declare a thinking level, or set reasoningEfforts to false for a non-reasoning model`);
  }
  return problems;
}

/** YAML lines for one model entry the user can paste into cordis.patch.yml. */
export function presetToYamlLines(preset, modelId, overrides = {}) {
  const { reasoningEfforts, compat } = presetToFragments(preset, overrides);
  const lines = [];
  lines.push(`          - id: ${modelId}`);
  lines.push(`            reasoningEfforts:`);
  for (const [gear, wire] of Object.entries(reasoningEfforts)) {
    lines.push(`              ${gear}: ${wire === null ? 'null' : JSON.stringify(wire)}`);
  }
  if (Object.keys(compat).length > 0) {
    lines.push(`            compat:`);
    for (const [key, value] of Object.entries(compat)) {
      lines.push(`              ${key}: ${JSON.stringify(value)}`);
    }
  }
  const route = presetToRouteFragments(preset, overrides);
  if (route.thinkingBudgets !== undefined) {
    lines.push('');
    lines.push(`            # 路由级（写在 providers.<route> 下，不是模型行内）：`);
    lines.push(`            # thinkingBudgets:`);
    for (const [gear, tokens] of Object.entries(route.thinkingBudgets)) {
      lines.push(`            #   ${gear}: ${tokens}`);
    }
  }
  return lines.join('\n');
}
