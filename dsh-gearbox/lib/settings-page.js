/**
 * The Gearbox settings page, served by the plugin itself at `GET /gears/ui`.
 *
 * ## Why a page of our own
 *
 * DSH's plugin manager only shows a "配置 <name>" entry for rows it tracks in its
 * config ledger, and its form is fed by the Host's settings-describe RPC. Neither
 * is something a third-party plugin can rely on, and the thing this plugin most
 * needs to show — **per model: the gears it declares versus the gears the adapter
 * actually advertises** — is not a generic schema form anyway.
 *
 * ## The form, not the file
 *
 * The page is a **form editor**, and deliberately does not show JSON for the
 * things a user thinks about:
 *
 *   - gears are a row of toggle chips over the standard ladder; picking a preset
 *     just fills the chips in, and saving writes the exact wire values;
 *   - an image role's provider and protocol are dropdowns.
 *
 * Writes go to `POST /gears/api/own-config`, which merges into this plugin's own
 * entry config. Writes that touch `llm-pi-ai` go to `POST /gears/api/apply`.
 * The only JSON on the page is behind an "高级" fold, for wire values that are
 * not the gear's own name (an endpoint that wants `high: "enabled"`, say) —
 * that is a power-user escape hatch, not the primary path.
 *
 * Everything on it is server-derived; nothing is hardcoded except labels.
 */

/** Escape a value for safe interpolation into HTML text or an attribute. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }

  /* ---- 滚动条：细圆角、内缩、悬停加深，随主题切换 ----
     Chromium/Electron/Safari 走 ::-webkit-scrollbar；Firefox 走 scrollbar-color。
     thumb 用透明边框 + background-clip: content-box 做出"细一点、离边缘有留白"的效果，
     比默认的宽灰条轻得多，也更接近系统级 overlay 滚动条。 */
  :root {
    --sb-thumb: rgba(15, 23, 42, 0.20);
    --sb-thumb-hover: rgba(15, 23, 42, 0.36);
  }
  :root[data-theme="dark"] {
    --sb-thumb: rgba(226, 232, 240, 0.26);
    --sb-thumb-hover: rgba(226, 232, 240, 0.44);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --sb-thumb: rgba(226, 232, 240, 0.26);
      --sb-thumb-hover: rgba(226, 232, 240, 0.44);
    }
  }
  html {
    scrollbar-width: thin;                       /* Firefox：细 */
    scrollbar-color: var(--sb-thumb) transparent;
    overscroll-behavior: contain;                /* 内嵌时不把滚动链传给外壳 */
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--sb-thumb);
    border-radius: 999px;
    border: 3px solid transparent;               /* 视觉上 4px 宽、离边 3px */
    background-clip: content-box;
    min-height: 44px;
  }
  ::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active { background-color: var(--sb-thumb-hover); }

  /* 触屏：轨道稍宽、拇指区更大，手指更容易命中；视觉仍是细条 */
  @media (pointer: coarse) {
    ::-webkit-scrollbar { width: 14px; height: 14px; }
    ::-webkit-scrollbar-thumb { border-width: 5px; min-height: 56px; }
  }

  body { margin: 0; padding: 20px; font: 14px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f6f7f9; color: #1c1e21; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e3e5e8; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  .sub { color: #6b7280; font-size: 12.5px; margin: 0 0 16px; }
  .card { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
  .model { border: 1px solid #e3e5e8; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: #fff; }
  .model-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .model-name { font-weight: 650; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  .route-tag { font-size: 11.5px; color: #6b7280; }
  .mtable { width: 100%; border-collapse: collapse; font-size: 13px; }
  .mtable th, .mtable td { padding: 8px 8px; border-bottom: 1px solid #eef0f2; vertical-align: middle; }
  .mtable select { max-width: 230px; }
  .modes { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
  .modes .row { display: flex; gap: 6px; align-items: center; }
  .modes .row input { width: 150px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef0f2; vertical-align: middle; }
  th { color: #6b7280; font-weight: 600; font-size: 12px; white-space: nowrap; }
  code, .mono { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 12px; }
  .gears { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
  .ok { color: #0a7d33; }
  .bad { color: #c02626; }
  .muted { color: #6b7280; }
  select, input[type=text], input[type=number], textarea { font: inherit; padding: 5px 7px; border: 1px solid #d5d8dd; border-radius: 6px; background: #fff; color: inherit; }
  textarea { width: 100%; min-height: 60px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid #c9ccd2; background: #fff; cursor: pointer; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .note { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .warn { color: #a35a00; font-size: 12px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: #2563eb; font-size: 12.5px; user-select: none; }
  .kv { display: grid; grid-template-columns: 130px 1fr; gap: 4px 10px; font-size: 13px; }
  .kv b { color: #6b7280; font-weight: 600; }
  .flash { position: fixed; right: 18px; bottom: 18px; background: #1c1e21; color: #fff; padding: 10px 14px; border-radius: 8px; font-size: 13px; max-width: 62%; display: none; z-index: 9; }
  .role-grid { display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; align-items: center; margin-bottom: 10px; }
  .role-grid .label { font-size: 12.5px; color: #374151; font-weight: 600; }
  .fields { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .fields label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: #6b7280; }
  .live { font-size: 12px; margin-top: 6px; }

  /* Dark theme, applied when the settings shell passes ?theme=dark or the page
     is opened standalone on a dark system. */
  :root[data-theme="dark"] { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; } }
  :root[data-theme="dark"] body, :root:not([data-theme="light"]) body { background: #17181a; color: #e6e7e9; }
  :root[data-theme="dark"] h2, :root:not([data-theme="light"]) h2 { border-bottom-color: #303236; }
  :root[data-theme="dark"] .card, :root[data-theme="dark"] .model,
  :root:not([data-theme="light"]) .card, :root:not([data-theme="light"]) .model { background: #1e2023; border-color: #303236; }
  :root[data-theme="dark"] th, :root[data-theme="dark"] td,
  :root:not([data-theme="light"]) th, :root:not([data-theme="light"]) td { border-bottom-color: #2a2c30; }
  :root[data-theme="dark"] th, :root[data-theme="dark"] .muted, :root[data-theme="dark"] .kv b,
  :root[data-theme="dark"] .sub, :root[data-theme="dark"] .route-tag, :root[data-theme="dark"] .note,
  :root[data-theme="dark"] .fields label,
  :root:not([data-theme="light"]) th, :root:not([data-theme="light"]) .muted, :root:not([data-theme="light"]) .kv b,
  :root:not([data-theme="light"]) .sub, :root:not([data-theme="light"]) .route-tag, :root:not([data-theme="light"]) .note,
  :root:not([data-theme="light"]) .fields label { color: #9aa0a6; }
  :root[data-theme="dark"] select, :root[data-theme="dark"] input, :root[data-theme="dark"] textarea, :root[data-theme="dark"] button,
  :root:not([data-theme="light"]) select, :root:not([data-theme="light"]) input, :root:not([data-theme="light"]) textarea, :root:not([data-theme="light"]) button { background: #26282c; border-color: #3a3d42; color: #e6e7e9; }
  :root[data-theme="dark"] button.primary, :root:not([data-theme="light"]) button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  :root[data-theme="dark"] .chip, :root:not([data-theme="light"]) .chip { background: #26282c; border-color: #3a3d42; color: #d6d8db; }
  :root[data-theme="dark"] .chip.on, :root:not([data-theme="light"]) .chip.on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  :root[data-theme="dark"] .chip.off-like.on, :root:not([data-theme="light"]) .chip.off-like.on { background: #64748b; border-color: #64748b; }
  :root[data-theme="dark"] details summary, :root:not([data-theme="light"]) details summary { color: #7aa7ff; }
  :root[data-theme="dark"] .role-grid .label, :root:not([data-theme="light"]) .role-grid .label { color: #d6d8db; }
  :root[data-theme="dark"] .ok, :root:not([data-theme="light"]) .ok { color: #4ade80; }
  :root[data-theme="dark"] .bad, :root:not([data-theme="light"]) .bad { color: #f87171; }
  :root[data-theme="dark"] .warn, :root:not([data-theme="light"]) .warn { color: #fbbf24; }
  :root[data-theme="dark"] .flash, :root:not([data-theme="light"]) .flash { background: #e6e7e9; color: #17181a; }
`;

/** Applied before first paint so a dark shell or system does not flash white. */
const THEME_INIT = `
(function () {
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q === 'dark' || q === 'light') { document.documentElement.dataset.theme = q; return; }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch (e) { /* theme is cosmetic; never block the page */ }
})();
`;

const PAGE_SCRIPT = `const LADDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PROTOCOL_LABEL = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Chat Completions',
  'anthropic-messages': 'Anthropic Messages'
};

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const flash = (msg, bad) => { const el = $('#flash'); el.textContent = msg; el.style.display = 'block'; el.style.background = bad ? '#7f1d1d' : '#1c1e21'; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 4200); };
const api = async (path, body) => {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: 'non-JSON response ' + res.status }));
  if (!json.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
};
const key = (route, model) => route + '|' + model;
const gearsOf = (efforts) => Object.entries(efforts || {})
  .filter(([, wire]) => wire !== null && wire !== undefined)
  .map(([gear, wire]) => gear + (wire === '' ? '' : ':' + wire));

const state = { info: null, inventory: null, presets: [], vendors: [], config: null, protocols: [] };

/** 该模型当前档位来源：预设规则、自定义条目，或未设置 */
function gearSource(route, model) {
  const rule = (state.config.rules || []).find((r) => r.route === route && r.model === model);
  if (rule && rule.preset) return { kind: 'preset', id: rule.preset };
  const custom = (state.config.customEfforts || []).find((r) => r.route === route && r.model === model);
  if (custom) {
    const gears = {};
    for (const [k, v] of Object.entries(custom)) if (!['route', 'model'].includes(k)) gears[k] = v;
    return { kind: 'custom', gears };
  }
  return null;
}

function presetSummary(preset) {
  const gears = Object.entries(preset.levels || {}).filter(([, w]) => w !== null && w !== undefined).map(([g]) => g);
  return preset.label + '（' + gears.join('/') + '）';
}

function renderStatus(info) {
  $('#status').innerHTML = [
    ['llm-pi-ai 路由', (info.routes || []).join(', ') || '—'],
    ['已配置档位', info.rules + ' 条（' + info.applyMode + '）'],
    ['供应商', Object.keys((info.lane || {}).providers || {}).join(', ') || '—'],
  ].map(([k, v]) => '<b>' + esc(k) + '</b><span>' + esc(v) + '</span>').join('');

  const la = info.lastApply;
  const box = $('#lastApply');
  if (!la) { box.innerHTML = '<span class="muted">尚未写入过。</span>'; return; }
  box.innerHTML = '<span class="' + (la.error ? 'bad' : 'muted') + '">'
    + (la.error ? '上次写入失败：' + esc(la.error) : '上次写入 ' + esc((la.at || '').replace('T', ' ').slice(0, 19)) + ' · ' + (la.changed ? '有变更' : '无变更') + ' · 尝试 ' + (la.attempts ?? 1) + ' 次')
    + '</span>'
    + ((la.rejected || []).length ? '<div class="bad">被拒绝：' + la.rejected.map((r) => esc((r.route || '-') + '/' + (r.model || '-') + ' — ' + (r.reason || (r.problems || []).join('; ')))).join('；') + '</div>' : '');
}

/** 档位下拉：厂家 → 模型 两级分组；末尾是「自定义…」 */
function gearOptions(selected) {
  let html = '<option value="">— 未设置 —</option>';
  for (const vendor of state.vendors) {
    html += '<optgroup label="' + esc(vendor.label) + '">';
    for (const model of vendor.models) {
      const value = 'preset:' + model.id;
      const mark = (state.suggested || []).includes(model.id) ? '（推荐）' : '';
      html += '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(model.label + mark + ' · ' + model.gears.join('/')) + '</option>';
    }
    html += '</optgroup>';
  }
  html += '<option value="custom"' + (selected === 'custom' ? ' selected' : '') + '>自定义档位…</option>';
  return html;
}

/** 自定义模式编辑器：每行 = 模式 + 传输值 */
function customRows(gears) {
  const entries = Object.entries(gears || {});
  if (entries.length === 0) return [{ gear: 'high', wire: 'high' }];
  return entries.map(([gear, wire]) => ({ gear, wire: wire === null ? '' : String(wire) }));
}

function modeSelect(name, value) {
  return '<select class="mode" data-name="' + name + '">' + LADDER.map((gear) => '<option value="' + gear + '"' + (gear === value ? ' selected' : '') + '>' + gear + '</option>').join('') + '</select>';
}

function renderModels(inv, presets) {
  const rows = inv.models || [];
  const protoOptions = (current) => state.protocols.map((p) => '<option value="' + esc(p) + '"' + (p === current ? ' selected' : '') + '>' + esc(PROTOCOL_LABEL[p] || p) + '</option>').join('');
  const head = '<tr><th>模型</th><th style="width:34%">思考档位</th><th style="width:20%">协议</th><th>前端实际可用</th></tr>';
  const body = rows.map((row) => {
    const k = key(row.route, row.model);
    const source = gearSource(row.route, row.model);
    const capable = (state.info && state.info.thinkingCapable !== undefined)
      ? (state.info.thinkingCapable[row.model] !== false)
      : true;
    const suggested = row.suggestedFit && row.suggestedFit.length ? row.suggestedFit : row.suggested || [];
    state.suggested = suggested;
    const selected = source ? (source.kind === 'preset' ? 'preset:' + source.id : 'custom') : '';
    const advertised = gearsOf((row.capabilities && row.capabilities.efforts) || null);
    let gearCell;
    if (!capable) {
      gearCell = '<span class="muted">— 无思考档位</span>';
    } else {
      gearCell = '<select class="gear" data-k="' + esc(k) + '">' + gearOptions(selected) + '</select>'
        + '<div class="modes" data-k="' + esc(k) + '"' + (selected === 'custom' ? '' : ' hidden') + '>'
        + customRows(source && source.kind === 'custom' ? source.gears : null).map((entry) =>
          '<div class="row">' + modeSelect(k, entry.gear)
          + '<input type="text" class="wire" value="' + esc(entry.wire) + '" placeholder="传输值，如 high">'
          + '<button type="button" class="rm" data-k="' + esc(k) + '" title="删除该模式">×</button></div>').join('')
        + '<div class="row"><button type="button" class="add" data-k="' + esc(k) + '">＋ 添加模式</button>'
        + '<button type="button" class="primary savecustom" data-k="' + esc(k) + '">保存自定义</button>'
        + '<button type="button" class="cancelcustom" data-k="' + esc(k) + '">取消</button></div>'
        + '<div class="note">传输值留空：off 表示不发任何字段，其余档位默认发与模式同名的值。</div></div>';
    }
    return '<tr>'
      + '<td><span class="mono">' + esc(row.model) + '</span><br><span class="route-tag">' + esc(row.route) + '</span></td>'
      + '<td>' + gearCell + '</td>'
      + '<td><select class="proto" data-model="' + esc(row.model) + '">' + protoOptions(row.api) + '</select></td>'
      + '<td class="gears ' + (advertised.length ? 'ok' : 'muted') + '">' + (advertised.length ? esc(advertised.join(' ')) : '—') + '</td>'
      + '</tr>';
  }).join('');
  $('#models').innerHTML = '<table class="mtable">' + head + body + '</table>'
    + '<div class="note">「前端实际可用」来自适配器本身，是 composer 渲染档位选择器的依据。档位与协议改动保存后立即生效。</div>';
}

function renderLane(info, config) {
  const lane = info.lane || {};
  const image = config.image || {};
  const providers = Object.keys(lane.providers || {});
  const host = ['<h3>提示词增强角色（图像通道）</h3>'];
  for (const id of ['promptEnhancer', 'editEnhancer']) {
    const role = (image.roles && image.roles[id]) || {};
    const resolved = (lane.roles || {})[id] || {};
    host.push('<div class="role-grid" data-role="' + esc(id) + '">'
      + '<span class="label">' + esc(id === 'promptEnhancer' ? '文生图提示词扩写 PE-T2I' : '编辑指令改写 PE-I2I') + '</span>'
      + '<span class="fields">'
      + '<label>供应商<select data-field="provider">' + providers.map((name) => '<option value="' + esc(name) + '"' + ((role.provider || resolved.provider) === name ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label>'
      + '<label>模型<input type="text" data-field="model" value="' + esc(role.model || resolved.model || '') + '" placeholder="模型 id"></label>'
      + '</span></div>');
  }
  host.push('<div class="row-actions"><button class="primary" id="saveLane">保存增强角色</button>'
    + '<span class="note">生成/编辑模型与协议已在上方模型列表中统一配置。</span></div>');
  $('#lane').innerHTML = host.join('');
}

function collectLane() {
  const image = JSON.parse(JSON.stringify((state.config && state.config.image) || {}));
  for (const grid of document.querySelectorAll('.role-grid')) {
    const id = grid.dataset.role;
    const role = {};
    const provider = grid.querySelector('[data-field="provider"]').value;
    const model = grid.querySelector('[data-field="model"]').value.trim();
    if (provider) role.provider = provider;
    if (model) role.model = model;
    if (model) {
      image.roles = image.roles || {};
      image.roles[id] = { ...(image.roles[id] || {}), ...role };
    }
  }
  return image;
}

async function boot() {
  const [info, inv, presets, config] = await Promise.all([
    api('/gears/api/info'), api('/gears/api/inventory'), api('/gears/api/presets'), api('/gears/api/own-config'),
  ]);
  state.info = info; state.inventory = inv; state.presets = presets.presets || [];
  state.vendors = presets.vendors || []; state.protocols = presets.protocols || [];
  state.config = config.config || {};
  renderStatus(info);
  renderModels(inv, state.presets);
  renderLane(info, state.config);
}

/** 用一份新的 rules + customEfforts 保存某模型的档位（并立即推送到 llm-pi-ai） */
async function saveGears(route, model, next) {
  const rules = (state.config.rules || []).filter((entry) => !(entry.route === route && entry.model === model));
  const customEfforts = (state.config.customEfforts || []).filter((entry) => !(entry.route === route && entry.model === model));
  if (next.kind === 'preset') rules.push({ route, model, preset: next.id });
  else if (next.kind === 'custom' && Object.keys(next.gears || {}).length) customEfforts.push({ route, model, ...next.gears });
  const out = await api('/gears/api/own-config', { rules, customEfforts });
  const wrote = ((out.efforts && out.efforts.applied) || []).length;
  state.config = out.config;
  flash('已保存 ' + model + '（' + wrote + ' 条写入 llm-pi-ai）');
  await boot();
}

document.addEventListener('change', async (event) => {
  const gearSel = event.target.closest('select.gear');
  if (gearSel) {
    const k = gearSel.dataset.k;
    const [route, model] = k.split('|');
    const value = gearSel.value;
    const modes = document.querySelector('.modes[data-k="' + CSS.escape(k) + '"]');
    if (value === 'custom') {
      if (modes) modes.hidden = false;
      return; // 等用户在编辑器里点「保存自定义」
    }
    if (modes) modes.hidden = true;
    if (!value) { await saveGears(route, model, { kind: 'custom', gears: {} }); return; }
    const id = value.slice('preset:'.length);
    await saveGears(route, model, { kind: 'preset', id });
    return;
  }
  const protoSel = event.target.closest('select.proto');
  if (protoSel) {
    const model = protoSel.dataset.model;
    const api2 = protoSel.value;
    try {
      const out = await api('/gears/api/protocol', { plan: { [model]: api2 } });
      flash(out.changed ? '已将 ' + model + ' 切换到 ' + (PROTOCOL_LABEL[api2] || api2) : '协议无变化');
      await boot();
    } catch (error) { flash(error.message, true); }
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target;
  const k = target.dataset && target.dataset.k;
  if (target.classList.contains('add') && k) {
    const box = document.querySelector('.modes[data-k="' + CSS.escape(k) + '"]');
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = modeSelect(k, 'low') + '<input type="text" class="wire" placeholder="传输值，如 high"><button type="button" class="rm" data-k="' + esc(k) + '">×</button>';
    box.insertBefore(row, box.querySelector('.row:last-child'));
    return;
  }
  if (target.classList.contains('rm') && k) {
    const row = target.closest('.row');
    if (row) row.remove();
    return;
  }
  if (target.classList.contains('cancelcustom') && k) {
    const sel = document.querySelector('select.gear[data-k="' + CSS.escape(k) + '"]');
    const modes = document.querySelector('.modes[data-k="' + CSS.escape(k) + '"]');
    if (modes) modes.hidden = true;
    if (sel) sel.value = sel.querySelector('option[value]:not([value="custom"]):not([value=""])') ? sel.options[1]?.value ?? '' : '';
    await boot();
    return;
  }
  if (target.classList.contains('savecustom') && k) {
    const [route, model] = k.split('|');
    const gears = {};
    for (const row of document.querySelectorAll('.modes[data-k="' + CSS.escape(k) + '"] .row')) {
      const mode = row.querySelector('.mode')?.value;
      if (!mode) continue;
      const wire = row.querySelector('.wire')?.value.trim();
      gears[mode] = wire === '' ? (mode === 'off' ? null : mode) : wire;
    }
    try { await saveGears(route, model, { kind: 'custom', gears }); }
    catch (error) { flash(error.message, true); }
    return;
  }
  if (target.id === 'saveLane') {
    target.disabled = true;
    try {
      await api('/gears/api/own-config', { image: collectLane() });
      flash('增强角色已保存。');
      await boot();
    } catch (error) { flash(error.message, true); } finally { target.disabled = false; }
  }
});

boot().catch((error) => { $('#flash').textContent = '加载失败：' + error.message; $('#flash').style.display = 'block'; });`;

/** The whole page: one HTML document, no external assets. */
export function settingsPage() {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模型变速箱 · 设置</title>
<style>${PAGE_STYLE}</style>
<script>${THEME_INIT}</script></head>
<body>
<h1>模型变速箱</h1>
<p class="sub">第三方模型的思考档位 × 图像生成通道。改动保存后立即生效，不需要重启。</p>

<div class="card"><h2 style="margin-top:0">状态</h2><div class="kv" id="status"></div>
<div id="lastApply" style="margin-top:10px"></div></div>

<div id="models"></div>

<h2>图像通道（增强角色）</h2>
<div class="card" id="lane"></div>

<div class="flash" id="flash"></div>
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}
