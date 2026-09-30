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
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 4px; }
  .chip { font: 12.5px/1 inherit; padding: 6px 12px; border-radius: 999px; border: 1px solid #d5d8dd; background: #fff; cursor: pointer; color: #374151; }
  .chip:hover { border-color: #2563eb; }
  .chip.on { background: #2563eb; border-color: #2563eb; color: #fff; }
  .chip.off-like.on { background: #64748b; border-color: #64748b; }
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

/** Applied before first paint so an embedded dark shell does not flash white. */
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

const PAGE_SCRIPT = `
const LADDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PROTOCOL_LABEL = {
  'images-generations': 'images/generations · 文生图',
  'images-edits': 'images/edits · 图片编辑',
  'chat': 'chat/completions · 文本'
};
const ROLE_LABEL = {
  generator: '文生图生成器', editor: '图生图编辑器',
  promptEnhancer: '提示词增强 PE-T2I', editEnhancer: '编辑指令改写 PE-I2I'
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

const state = { info: null, inventory: null, presets: [], config: null, ui: new Map() };

/** The gears one preset offers: off always, the others when the preset sets them. */
function presetGears(preset) {
  const levels = preset.levels || {};
  const out = new Set(['off']);
  for (const gear of LADDER) if (gear !== 'off' && levels[gear] !== null && levels[gear] !== undefined) out.add(gear);
  return out;
}
function presetWire(preset) {
  const levels = preset.levels || {};
  const out = {};
  for (const gear of presetGears(preset)) out[gear] = (gear === 'off' && levels[gear] === undefined) ? null : levels[gear];
  return out;
}

/** Per-model editor state: selected chips, exact wire values, chosen preset. */
function modelUi(row, presets) {
  const k = key(row.route, row.model);
  if (state.ui.has(k)) return state.ui.get(k);
  const declared = row.declaredReasoningEfforts && Object.keys(row.declaredReasoningEfforts).length
    ? row.declaredReasoningEfforts
    : null;
  let selected; let wire; let preset = null;
  if (declared) {
    selected = new Set(Object.keys(declared));
    wire = { ...declared };
  } else {
    // 自动推荐：模型还没配档位时，预填协议最匹配的预设
    const fit = (row.suggestedFit && row.suggestedFit.length ? row.suggestedFit : row.suggested || []);
    preset = fit[0] || null;
    const p = presets.find((x) => x.id === preset);
    wire = p ? presetWire(p) : { high: 'high' };
    selected = new Set(Object.keys(wire));
  }
  const ui = { selected, wire, preset, declared: Boolean(declared) };
  state.ui.set(k, ui);
  return ui;
}

function renderStatus(info) {
  $('#status').innerHTML = [
    ['预设库', info.presets + ' 组'],
    ['llm-pi-ai 路由', (info.routes || []).join(', ') || '—'],
    ['档位规则', info.rules + ' 条（' + info.applyMode + '）'],
  ].map(([k, v]) => '<b>' + esc(k) + '</b><span>' + esc(v) + '</span>').join('');

  const la = info.lastApply;
  const box = $('#lastApply');
  if (!la) { box.innerHTML = '<span class="muted">尚未写入过。auto 模式会在激活后自动写入。</span>'; return; }
  const bits = ['时间 ' + esc(la.at), '来源 ' + esc(la.source), la.changed ? '有写入' : '无变更（已一致）', '尝试 ' + (la.attempts ?? 1) + ' 次'];
  box.innerHTML = '<div class="kv">' + bits.map((b) => '<span>' + esc(b) + '</span>').join('') + '</div>'
    + (la.error ? '<div class="bad">错误：' + esc(la.error) + '</div>' : '')
    + ((la.rejected || []).length ? '<div class="bad">被拒绝：' + la.rejected.map((r) => esc((r.route || '-') + '/' + (r.model || '-') + ' — ' + (r.reason || (r.problems || []).join('; ')))).join('；') + '</div>' : '')
    + ((la.applied || []).some((row) => (row.notes || []).length)
      ? '<details><summary>协议适配说明</summary>' + la.applied.flatMap((row) => (row.notes || []).map((note) => '<div class="note">' + esc(row.route + '/' + row.model + ' — ' + note) + '</div>')).join('') + '</details>'
      : '');
}

function renderGears(inv, presets) {
  const byRoute = new Map();
  for (const row of inv.models || []) {
    if (!byRoute.has(row.route)) byRoute.set(row.route, { api: row.api, rows: [] });
    byRoute.get(row.route).rows.push(row);
  }
  const host = [];
  for (const [route, group] of byRoute) {
    host.push('<h2>路由 ' + esc(route) + ' <span class="route-tag">· ' + esc(group.api) + '</span></h2>');
    for (const row of group.rows) {
      const ui = modelUi(row, presets);
      const k = key(row.route, row.model);
      const advertised = gearsOf((row.capabilities && row.capabilities.efforts) || null);
      const chips = LADDER.map((gear) => {
        const on = ui.selected.has(gear);
        return '<button type="button" class="chip' + (on ? ' on' : '') + (gear === 'off' ? ' off-like' : '') + '" data-k="' + esc(k) + '" data-gear="' + gear + '">' + gear + '</button>';
      }).join('');
      const fit = (row.suggestedFit && row.suggestedFit.length ? row.suggestedFit : row.suggested || []);
      const others = (row.suggested || []).filter((id) => !fit.includes(id));
      const presetOptions = '<option value="">— 手动点选档位 —</option>'
        + fit.map((id) => '<option value="' + esc(id) + '"' + (ui.preset === id ? ' selected' : '') + '>' + esc(id) + '</option>').join('')
        + (others.length ? '<optgroup label="协议不匹配（保存时会被适配）">' + others.map((id) => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('') + '</optgroup>' : '');
      host.push('<div class="model">'
        + '<div class="model-head"><span class="model-name">' + esc(row.model) + '</span>'
        + '<span class="route-tag">' + esc(group.api) + '</span>'
        + '<span style="flex:1 1 auto"></span>'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280">推荐预设 <select class="preset" data-k="' + esc(k) + '">' + presetOptions + '</select></label>'
        + '</div>'
        + '<div class="chips">' + chips + '</div>'
        + '<div class="live">前端实际可用：<span class="' + (advertised.length ? 'ok mono' : 'muted') + '">' + (advertised.length ? esc(advertised.join('  ')) : '—（尚未写入）') + '</span></div>'
        + '<div class="row-actions" style="margin-top:10px">'
        + '<button class="primary" data-act="save" data-k="' + esc(k) + '">保存档位</button>'
        + '<button data-act="clear" data-k="' + esc(k) + '">清除</button>'
        + '</div>'
        + '<details><summary>高级 · 精确映射（某些端点要求 high=&quot;enabled&quot; 这类取值）</summary>'
        + '<textarea class="advanced" data-k="' + esc(k) + '" placeholder="{ &quot;off&quot;: null, &quot;high&quot;: &quot;high&quot; }">' + esc(JSON.stringify(ui.wire)) + '</textarea>'
        + '<div class="note">这里改的是发往端点的精确值。改完点「保存档位」，芯片会按这里的取值重新点亮。</div>'
        + '</details>'
        + '</div>');
    }
  }
  $('#gears').innerHTML = host.join('') || '<div class="card muted">llm-pi-ai 上没有模型。</div>';
}

function renderLane(info, config) {
  const lane = info.lane || {};
  const image = config.image || {};
  const providers = Object.keys(lane.providers || {});
  const host = [];
  host.push('<div class="kv">'
    + '<b>保存目录</b><span class="mono">' + esc(lane.saveDir || '.dsh-gearbox') + '</span>'
    + '<b>自动增强</b><span>' + (lane.autoEnhance ? '开' : '关') + '</span>'
    + '</div>');

  host.push('<h3>供应商</h3>');
  host.push('<div class="card">' + Object.entries(lane.providers || {}).map(([name, p]) =>
    '<div class="kv"><b>' + esc(name) + '</b><span class="mono">' + esc(p.baseURL) + '</span>'
    + '<b>凭据引用</b><span class="mono">' + esc(p.credentialRef) + '</span></div>').join('')
    + '<div class="note">供应商只放连接信息；协议绑在下面每个角色上。凭据本体在 DSH 凭据存储里。</div></div>');

  host.push('<h3>角色 → 模型 + 协议</h3>');
  for (const id of ['generator', 'editor', 'promptEnhancer', 'editEnhancer']) {
    const role = (image.roles && image.roles[id]) || {};
    const resolved = (lane.roles || {})[id] || {};
    host.push('<div class="role-grid" data-role="' + esc(id) + '">'
      + '<span class="label">' + esc(ROLE_LABEL[id] || id) + '</span>'
      + '<span class="fields">'
      + '<label>供应商<select data-field="provider">' + providers.map((name) => '<option value="' + esc(name) + '"' + ((role.provider || resolved.provider) === name ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label>'
      + '<label>模型<input type="text" data-field="model" value="' + esc(role.model || resolved.model || '') + '" placeholder="模型 id"></label>'
      + '<label>协议<select data-field="protocol">' + Object.entries(PROTOCOL_LABEL).map(([value, label]) => '<option value="' + esc(value) + '"' + ((role.protocol || resolved.protocol) === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select></label>'
      + '<label>尺寸<input type="text" data-field="size" value="' + esc(role.size || resolved.size || '') + '" placeholder="1024x1024"></label>'
      + (id === 'editor' ? '<label>最多输入图<input type="number" data-field="maxInputImages" value="' + esc(role.maxInputImages || resolved.maxInputImages || 4) + '" min="1" max="4" style="width:76px"></label>' : '')
      + '</span></div>');
  }
  host.push('<div class="row-actions" style="margin-top:6px"><button class="primary" id="saveLane">保存图像通道</button>'
    + '<span class="note">保存后立即生效，不需要重启。</span></div>');
  $('#lane').innerHTML = host.join('');
}

function collectLane() {
  const image = JSON.parse(JSON.stringify((state.config && state.config.image) || {}));
  image.roles = image.roles || {};
  for (const grid of document.querySelectorAll('.role-grid')) {
    const id = grid.dataset.role;
    const read = (field) => grid.querySelector('[data-field="' + field + '"]');
    const role = {};
    const provider = read('provider').value;
    const model = read('model').value.trim();
    const protocol = read('protocol').value;
    const size = read('size').value.trim();
    if (provider) role.provider = provider;
    if (model) role.model = model;
    if (protocol) role.protocol = protocol;
    if (size) role.size = size;
    if (id === 'editor') {
      const max = Number(read('maxInputImages').value);
      if (Number.isFinite(max) && max > 0) role.maxInputImages = max;
    }
    if (model) image.roles[id] = role;
  }
  return image;
}

async function boot() {
  const [info, inv, presets, config] = await Promise.all([
    api('/gears/api/info'), api('/gears/api/inventory'), api('/gears/api/presets'), api('/gears/api/own-config'),
  ]);
  state.info = info; state.inventory = inv; state.presets = presets.presets || []; state.config = config.config || {};
  state.ui = new Map();
  renderStatus(info);
  renderGears(inv, state.presets);
  renderLane(info, state.config);
}

document.addEventListener('click', async (event) => {
  const chip = event.target.closest('.chip');
  if (chip) {
    const ui = state.ui.get(chip.dataset.k);
    if (!ui) return;
    const gear = chip.dataset.gear;
    ui.preset = null;
    if (ui.selected.has(gear)) ui.selected.delete(gear); else ui.selected.add(gear);
    chip.classList.toggle('on');
    const sel = document.querySelector('select.preset[data-k="' + CSS.escape(chip.dataset.k) + '"]');
    if (sel) sel.value = '';
    return;
  }
  const btn = event.target.closest('button[data-act]');
  if (!btn) return;
  const k = btn.dataset.k;
  const [route, model] = k.split('|');
  const ui = state.ui.get(k);
  btn.disabled = true;
  try {
    if (btn.dataset.act === 'save') {
      const advanced = document.querySelector('textarea.advanced[data-k="' + CSS.escape(k) + '"]');
      let efforts;
      if (advanced && advanced.closest('details')?.open && advanced.value.trim()) {
        try { efforts = JSON.parse(advanced.value); } catch (e) { throw new Error('精确映射不是合法 JSON：' + e.message); }
      } else {
        efforts = {};
        for (const gear of LADDER) {
          if (!ui.selected.has(gear)) continue;
          const prev = ui.wire[gear];
          efforts[gear] = (prev !== undefined && prev !== null) ? prev : (gear === 'off' ? null : gear);
        }
      }
      ui.wire = efforts;
      ui.selected = new Set(Object.keys(efforts));
      // 一个模型只留一条规则来源：选了预设就写预设规则，手点芯片就写自定义档位。
      // 两条并存时后者虽然会赢，但留在配置里是死配置，也会让「已应用」列表出现两行。
      const rules = (state.config.rules || []).filter((entry) => !(entry.route === route && entry.model === model));
      let customEfforts = (state.config.customEfforts || []).filter((entry) => !(entry.route === route && entry.model === model));
      if (ui.preset) {
        rules.push({ route, model, preset: ui.preset });
      } else if (Object.keys(efforts).length) {
        customEfforts = [...customEfforts, { route, model, ...efforts }];
      }
      const out = await api('/gears/api/own-config', { rules, customEfforts });
      const wrote = ((out.efforts && out.efforts.applied) || []).length;
      flash('已保存 ' + model + '：' + Object.keys(efforts).join(' / ') + '（' + wrote + ' 条写入 llm-pi-ai）');
      await boot();
    } else if (btn.dataset.act === 'clear') {
      const rules = (state.config.rules || []).filter((entry) => !(entry.route === route && entry.model === model));
      const customEfforts = (state.config.customEfforts || []).filter((entry) => !(entry.route === route && entry.model === model));
      await api('/gears/api/own-config', { rules, customEfforts });
      flash('已清除 ' + model + ' 的档位配置。');
      await boot();
    }
  } catch (error) {
    flash(error.message, true);
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('change', (event) => {
  const select = event.target.closest('select.preset');
  if (!select) return;
  const ui = state.ui.get(select.dataset.k);
  if (!ui) return;
  const preset = state.presets.find((p) => p.id === select.value);
  if (!preset) { ui.preset = null; return; }
  ui.preset = preset.id;
  ui.wire = presetWire(preset);
  ui.selected = new Set(Object.keys(ui.wire));
  for (const chip of document.querySelectorAll('.chip[data-k="' + CSS.escape(select.dataset.k) + '"]')) {
    chip.classList.toggle('on', ui.selected.has(chip.dataset.gear));
  }
  flash('已按预设 ' + preset.id + ' 预填档位，点「保存档位」生效。');
});

document.addEventListener('click', async (event) => {
  if (event.target.id !== 'saveLane') return;
  const btn = event.target;
  btn.disabled = true;
  try {
    await api('/gears/api/own-config', { image: collectLane() });
    flash('图像通道已保存。');
    await boot();
  } catch (error) {
    flash(error.message, true);
  } finally {
    btn.disabled = false;
  }
});

boot().catch((error) => { $('#flash').textContent = '加载失败：' + error.message; $('#flash').style.display = 'block'; });
`;

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

<div id="gears"></div>

<h2>图像通道</h2>
<div class="card" id="lane"></div>

<div class="flash" id="flash"></div>
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}
