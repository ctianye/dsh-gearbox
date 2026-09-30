/**
 * Vendor catalog: the 「厂家 → 模型」 layer over the gear presets, plus the
 * "does this model think at all?" test.
 *
 * Sources for the transport-field facts live in `research/vendor-effort-specs.md`;
 * this module only organises the presets this plugin ships, so the settings page
 * can present them the way a user thinks: pick the vendor, then the model.
 */

/** Vendors, in display order. `presets` references ids from `lib/presets.js`. */
export const VENDORS = [
  { id: 'openai', label: 'OpenAI', docs: 'https://developers.openai.com/api/docs/guides/reasoning', presets: ['openai-gpt5', 'openai-gpt5-base', 'openai-generic-effort', 'openai-generic-budget'] },
  { id: 'deepseek', label: 'DeepSeek（深度求索）', docs: 'https://api-docs.deepseek.com/zh-cn/guides/thinking_mode', presets: ['deepseek-v4'] },
  { id: 'anthropic', label: 'Anthropic（Claude）', docs: 'https://docs.anthropic.com/docs/en/build-with-claude/effort', presets: ['claude-adaptive', 'claude-budget'] },
  { id: 'google', label: 'Google（Gemini）', docs: 'https://ai.google.dev/gemini-api/docs/generate-content/thinking', presets: ['gemini'] },
  { id: 'alibaba', label: '阿里云百炼（Qwen）', docs: 'https://www.alibabacloud.com/help/doc-detail/3016807.html', presets: ['qwen38', 'qwen36'] },
  { id: 'zhipu', label: '智谱（GLM）', docs: 'https://docs.bigmodel.cn', presets: ['glm-zai', 'glm-gateway'] },
  { id: 'moonshot', label: '月之暗面（Kimi）', docs: 'https://platform.moonshot.cn/docs', presets: ['kimi-k2', 'kimi-k3'] },
  { id: 'xai', label: 'xAI（Grok）', docs: 'https://docs.x.ai', presets: ['grok'] },
  { id: 'openrouter', label: 'OpenRouter（聚合）', docs: 'https://openrouter.ai/docs/use-cases/reasoning-tokens', presets: ['openrouter'] },
];

/**
 * Model-id patterns that have **no thinking control at all**. These get no gear
 * presets in the UI — offering them would be inventing a dial the endpoint
 * does not have.
 */
export const NON_THINKING = [/image/i, /^PE-/i, /embedding/i, /rerank/i, /tts/i, /whisper/i, /moderation/i];

/** Whether a model id looks like it has a thinking control at all. */
export function isThinkingCapable(modelId) {
  const id = String(modelId ?? '');
  return !NON_THINKING.some((pattern) => pattern.test(id));
}

/**
 * The vendor tree for the settings page: one entry per vendor, each with the
 * presets that belong to it, already summarised for a dropdown label.
 *
 * @param {GearPreset[]} presets  the flat preset list from `lib/presets.js`
 * @returns {Array<{id,label,docs,models:Array<{id,label,gears:string[],defaultGear:string|null,note:string}>}>}
 */
export function vendorTree(presets) {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const tree = [];
  for (const vendor of VENDORS) {
    const models = vendor.presets
      .map((id) => byId.get(id))
      .filter((preset) => preset !== undefined)
      .map((preset) => ({
        id: preset.id,
        label: preset.label,
        gears: Object.entries(preset.levels ?? {})
          .filter(([gear, wire]) => wire !== null && wire !== undefined)
          .map(([gear]) => gear),
        defaultGear: preset.defaultGear ?? null,
        note: preset.note ?? '',
      }));
    if (models.length === 0) continue;
    tree.push({ id: vendor.id, label: vendor.label, docs: vendor.docs, models });
  }
  return tree;
}
