/**
 * Mock-context activation harness for dsh-gearbox.
 *
 * Runs the plugin's `apply()` end-to-end against a faithful stand-in for the
 * Cordis host surface — service injection, tool registration, route
 * registration, credential resolution, and the configEditor write path — so
 * import errors, schema errors, and logic errors surface here, seconds after an
 * edit, instead of in a live DSH boot.
 *
 * Module resolution is deliberately *not* stubbed. `setup-dev-links.mjs` gives
 * the plugin directory a real `@deepseek-ai/*` closure, so this harness imports
 * the plugin exactly the way DSH's loader does. If a bare specifier stops
 * resolving, this harness fails the same way the Harness would.
 *
 * Run: node D:\dsh_pludge\scripts\harness.mjs
 */
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';

const PLUGIN = 'D:/dsh_pludge/lib/index.js';
const SANDBOX = 'D:/dsh_pludge/.workbuddy/tmp/harness-workspace';

// ---- recorded interactions ----
const calls = { tools: [], routes: [], provides: [], effects: [], edits: [], commands: [] };
/** Services the plugin published with ctx.provide, by name. */
const provided = {};

const llmPiAiEntry = { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' } };

/**
 * Faithful stand-in for the two layers `configEditor` reads.
 *
 *  - `bundleLayer` — what the llm-pi-ai bundle ships (here: one route the user
 *    never wrote into their profile patch).
 *  - `profileRow` — the profile patch row. This is the UJN/Sensenova block the
 *    desktop profile actually carries, and it is what `entry.options.config`
 *    holds once `cordis-plugin-include` has assigned it over the entry.
 *
 * A patch row replaces the whole `config` key rather than deep-merging, so the
 * write path must produce complete provider profiles. Modelling both layers is
 * what makes the harness able to catch a partial (provider-destroying) write.
 */
const bundleLayer = {
  providers: {
    'bundle-default': { displayName: 'Bundle default', apiKeyEnv: 'BUNDLE_API_KEY', api: 'openai-completions', baseURL: 'https://bundle.invalid/v1', models: [{ id: 'bundle-model', name: 'bundle-model' }] },
    // No `models` list: dsh-llm-pi-ai calls this a catalog-backed route, and
    // refuses modelOverrides beside a models list, so this route must be
    // written through `modelOverrides` instead of a new `models` entry.
    'catalog-route': { displayName: 'Catalog route', apiKeyEnv: 'CATALOG_API_KEY', api: 'openai-completions', baseURL: 'https://catalog.invalid/v1' },
  },
};

const profileRow = {
  providers: {
    ujn: {
      displayName: 'UJN',
      apiKeyEnv: 'UJN_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://llm.ujn.edu.cn/v1',
      models: [
        { id: 'deepseek-v41-flash', name: 'deepseek-v41-flash', contextWindow: 1048576, input: ['text', 'image'] },
        { id: 'Qwen3.8-Flash-Next', name: 'Qwen3.8-Flash-Next', contextWindow: 253952, input: ['text', 'image'] },
        { id: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash', contextWindow: 1048576, input: ['text', 'image'] },
        { id: 'Qwen-Image-2.1', name: 'Qwen-Image-2.1', contextWindow: 4096, input: ['text', 'image'] },
        { id: 'Qwen-Image-PE-T2I', name: 'Qwen-Image-PE-T2I', contextWindow: 16384, input: ['image'] },
        { id: 'Qwen-Image-PE-I2I', name: 'Qwen-Image-PE-I2I', contextWindow: 32768, input: ['image'] },
      ],
    },
    sensenova: {
      displayName: 'Sensenova',
      apiKeyEnv: 'SENSENOVA_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://token.sensenova.cn/v1',
      models: [{ id: 'kimi-k3', name: 'kimi-k3', contextWindow: 1048576 }],
    },
  },
};

// The composed entry: the profile row wins the `config` key wholesale.
llmPiAiEntry.options.config = structuredClone(profileRow);

/** The profile patch row's config, as the editor would read it after a write. */
let storedRowConfig = structuredClone(profileRow);

const inheritedProviders = profileRow.providers;

const configEditor = {
  entries: () => [llmPiAiEntry],
  configuration: () => [{ entry: llmPiAiEntry, inherited: structuredClone(bundleLayer), override: structuredClone(storedRowConfig) }],
  async edit(entry, change) {
    // Mirrors @deepseek-ai/dsh-config-editor: (entry options config, bundle layer).
    const current = structuredClone(entry.options.config ?? {});
    const inherited = structuredClone(bundleLayer);
    const next = change(current, inherited);
    calls.edits.push(next);
    // A real write lands in the profile patch and hot-reloads, so the next read
    // sees the new config. Without this the harness could never observe that a
    // second identical apply is a no-op.
    storedRowConfig = structuredClone(next);
    entry.options.config = structuredClone(next);
    return next;
  },
};

const llm = {
  async listModels(route) {
    return (inheritedProviders[route]?.models ?? []).map((m) => ({ provider: route, id: m.id, name: m.name, inputModalities: m.input ?? ['text'] }));
  },
  async resolveModelInfo(route, model) {
    if (model.startsWith('Qwen-Image')) {
      return { provider: route, id: model, name: model, inputModalities: ['image'], context: { contextWindow: 16384 } };
    }
    return {
      provider: route,
      id: model,
      name: model,
      inputModalities: ['text', 'image'],
      context: { contextWindow: 1048576 },
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
    };
  },
};

const credentials = {
  async resolve(ref) {
    return ref === 'UJN_API_KEY' ? { ref, value: 'sk-mock-not-real' } : undefined;
  },
};

const toolsRegistry = {
  register(definition) {
    calls.tools.push(definition);
    return () => {};
  },
};

const webServer = {
  register(route) {
    calls.routes.push(route);
    return () => {};
  },
};

const commandsRegistry = {
  register(definition) {
    calls.commands.push(definition);
    return () => {};
  },
};

const ctx = {
  logger: {
    info: (...args) => console.log('[info]', ...args),
    warn: (...args) => console.log('[warn]', ...args),
    error: (...args) => console.log('[error]', ...args),
  },
  // Cordis exposes every injected service both as a `ctx.<name>` property and
  // through `ctx.get(name)`. The plugin uses both spellings, so the mock must
  // carry both or it would report a false failure.
  get configEditor() { return configEditor; },
  get llm() { return llm; },
  get credentials() { return credentials; },
  get webServer() { return webServer; },
  get tools() { return toolsRegistry; },
  get commands() { return commandsRegistry; },
  get(name) {
    const table = { configEditor, llm, credentials, webServer, tools: toolsRegistry, commands: commandsRegistry };
    if (name in table) return table[name];
    throw new Error(`mock ctx.get: unknown service "${name}"`);
  },
  provide(name, value) {
    calls.provides.push(name);
    if (name === 'gearbox') provided.gearbox = value;
    return () => {};
  },
  effect(fn, label) {
    calls.effects.push(label ?? '<anonymous>');
    return fn();
  },
};

/** Route the plugin registered, by path — used to drive it like the panel would. */
function routeFor(path) {
  return calls.routes.find((route) => route.path === path);
}

/** Fake node:http req/res pair that collects the handler's response. */
async function invokeRoute(route, { method = 'GET', body } = {}) {
  const url = route.path;
  const req = { method, url, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
  let status;
  let payload = '';
  const res = {
    writeHead(code) { status = code; },
    end(chunk) { payload += chunk ?? ''; },
  };
  await route.handler(req, res);
  return { status, json: payload.length > 0 ? JSON.parse(payload) : undefined };
}

// ---- run ----
console.log('=== importing plugin module (real DSH resolution, no stubs) ===');
const plugin = await import(pathToFileURL(PLUGIN).href);
console.log('exports :', Object.keys(plugin).join(', '));
console.log('name    :', plugin.name);
console.log('inject  :', JSON.stringify(plugin.inject));

console.log('\n=== Config schema builds ===');
const schema = plugin.Config;
const fails = [];
try {
  schema({ rules: [{ route: 'ujn', model: 'GLM-5.3-Flash', preset: 'glm-zai' }], applyMode: 'auto' });
} catch (error) {
  fails.push(`valid config rejected: ${error.message}`);
}
try {
  const bad = schema({ applyMode: 'nonsense' });
  if (bad.applyMode === 'nonsense') fails.push('invalid applyMode accepted');
} catch {
  /* rejecting is the expected outcome */
}
// preset is a union of the library's ids, so a typo must be refused at save
// time rather than written as a config that silently does nothing.
try {
  schema({ rules: [{ route: 'ujn', model: 'x', preset: 'not-a-preset' }] });
  fails.push('unknown preset id accepted (the picker would silently write a no-op rule)');
} catch {
  /* expected */
}
try {
  schema({ rules: [{ route: 'ujn', model: 'x', preset: 'glm-gateway' }] });
} catch (error) {
  fails.push(`a library preset id was rejected: ${error.message}`);
}
console.log('Config type :', schema?.type ?? typeof schema, '|', fails.length === 0 ? 'PASS' : `FAIL: ${fails.join('; ')}`);
for (const failure of fails) problems.push(`Config: ${failure}`);

console.log('\n=== apply() ===');
const IMAGE_CONFIG = {
  providers: {
    ujn: {
      baseURL: 'https://llm.ujn.edu.cn/v1',
      apiKeyEnv: 'UJN_API_KEY',
      style: 'chat',
      generator: 'Qwen-Image-2.1',
      promptEnhancer: 'Qwen-Image-PE-T2I',
      editEnhancer: 'Qwen-Image-PE-I2I',
      size: '1024x1024',
    },
  },
  defaultProvider: 'ujn',
  saveDir: '.dsh-gearbox',
  autoEnhance: true,
};

plugin.apply(ctx, {
  rules: [
    { route: 'ujn', model: 'GLM-5.3-Flash', preset: 'glm-zai' },
    { route: 'ujn', model: 'Qwen3.8-Flash-Next', preset: 'qwen38' },
    // A route that exists only in the bundle layer: proves the write path sees
    // both layers instead of silently skipping (and that it flattens the
    // provider profile it touches rather than writing a partial one).
    { route: 'bundle-default', model: 'bundle-model', preset: 'openai-generic-effort' },
    // A catalog-backed route: its fields must go to modelOverrides, never to a
    // new models entry (the adapter refuses the two homes together).
    { route: 'catalog-route', model: 'catalog-model', preset: 'openai-generic-effort' },
  ],
  applyMode: 'auto',
  image: IMAGE_CONFIG,
});

console.log('\n=== registration summary ===');
// Auto-apply is deferred off the activation stack (configEditor cannot open a
// nested HMR transaction), so give the scheduled write a tick to land before
// the assertions below read its outcome.
await new Promise((resolve) => setTimeout(resolve, 600));
console.log('tools             :', calls.tools.map((t) => t.name).join(', ') || '(none)');
console.log('routes            :', calls.routes.map((r) => `${r.kind} ${r.path}`).join(', ') || '(none)');
console.log('services provided :', calls.provides.join(', ') || '(none)');
console.log('effects           :', calls.effects.length);

const problems = [];
if (!calls.routes.some((r) => r.path === '/gears/api')) problems.push('panel prefix route missing');
if (calls.provides.length === 0) problems.push('no service provided');

console.log('\n=== registered slash commands ===');
for (const command of calls.commands) {
  console.log(`/${command.name} — ${command.description}`);
  console.log(`  input hint : ${command.input?.hint ?? '(none)'}`);
  if (typeof command.description !== 'string' || command.description.trim().length === 0) problems.push(`command ${command.name} has an empty description (rejected by dsh-commands)`);
  if (typeof command.handler !== 'function') problems.push(`command ${command.name} has no handler`);
  if (command.input !== undefined && (typeof command.input.hint !== 'string' || command.input.hint.trim().length === 0)) problems.push(`command ${command.name} input hint must be a non-empty string`);
}

// ---- exercise the panel routes ----
console.log('\n=== panel routes ===');
// The prefix handler dispatches on url.pathname, so drive each sub-route directly.
const prefix = routeFor('/gears/api');
for (const path of ['/gears/api/info', '/gears/api/presets', '/gears/api/inventory']) {
  const { status, json } = await invokeRoute({ ...prefix, path }, { method: 'GET' });
  const size = json?.presets?.length ?? json?.models?.length ?? Object.keys(json ?? {}).length;
  console.log(`GET  ${path.padEnd(24)} -> ${status} (${size} entries)`);
  if (status !== 200 || json?.ok !== true) { problems.push(`${path} not OK: ${JSON.stringify(json).slice(0,200)}`); }
  if (path.endsWith('/presets') && (json?.presets?.length ?? 0) < 16) problems.push('preset library short of 16 entries');
}

const exported = await invokeRoute({ ...prefix, path: '/gears/api/export' }, { method: 'POST', body: { rules: [{ model: 'GLM-5.3-Flash', preset: 'glm-zai' }] } });
console.log('POST /gears/api/export    ->', exported.status, `${(exported.json?.yaml ?? '').split('\n').length} yaml lines`);
if (exported.status !== 200 || !exported.json?.yaml?.includes('reasoningEfforts')) problems.push('YAML export malformed');

const applied = await invokeRoute({ ...prefix, path: '/gears/api/apply' }, { method: 'POST', body: { rules: [{ route: 'ujn', model: 'GLM-5.3-Flash', preset: 'glm-zai' }] } });
console.log('POST /gears/api/apply     ->', applied.status, JSON.stringify(applied.json?.applied));
if (applied.status !== 200 || (applied.json?.applied?.length ?? 0) !== 1) problems.push('/gears/api/apply did not write');

// A second identical apply must not touch the profile again — activation on
// config reload re-runs auto-apply, and a non-idempotent write would loop.
const reapplied = await invokeRoute({ ...prefix, path: '/gears/api/apply' }, { method: 'POST', body: { rules: [{ route: 'ujn', model: 'GLM-5.3-Flash', preset: 'glm-zai' }] } });
console.log('POST /gears/api/apply (2nd) ->', reapplied.status, 'changed =', reapplied.json?.changed);
if (reapplied.json?.changed !== false) problems.push('apply is not idempotent (would re-write on every reload)');

const rejectedProbe = await invokeRoute({ ...prefix, path: '/gears/api/validate' }, { method: 'POST', body: { rules: [{ route: 'nope', model: 'x', preset: 'glm-zai' }, { route: 'ujn', model: 'y', preset: 'does-not-exist' }] } });
console.log('POST /gears/api/validate  ->', rejectedProbe.status, 'rejected =', JSON.stringify(rejectedProbe.json?.rejected?.map((r) => r.reason)));
if ((rejectedProbe.json?.rejected?.length ?? 0) !== 2) problems.push('/gears/api/validate did not report both bad rules');

// ---- the preset library must survive the adapter's own admission rules ----
console.log('\n=== preset library admission sweep (mirrors dsh-llm-pi-ai) ===');
const face = provided.gearbox;
if (face === undefined) {
  problems.push('gearbox service was not provided');
} else {
  for (const preset of face.presets()) {
    const fragments = face.fragmentsFor({ model: 'sweep', preset: preset.id });
    const violations = face.problems('sweep', fragments.reasoningEfforts);
    const gears = Object.entries(fragments.reasoningEfforts).map(([gear, wire]) => `${gear}=${wire === null ? '∅' : wire}`).join(' ');
    console.log(`${preset.id.padEnd(24)} ${gears}`);
    if (violations.length > 0) problems.push(`preset ${preset.id}: ${violations.join('; ')}`);
  }
  // Every preset must also come out of YAML export non-empty and well-formed.
  const yamlAll = face.exportYaml(face.presets().map((preset) => ({ model: 'sweep', preset: preset.id })));
  if (!yamlAll.includes('- id: sweep')) problems.push('YAML export produced nothing usable');
}

// ---- the client half must survive being loaded as a CLASSIC script ----
// This is not a formality: the client bundle is served over `dsh-app://` and
// concatenated into one script, so a single ESM `import`/`export` statement in
// it is a renderer-wide syntax error, and the app's next boot resets the
// profile. That exact failure shipped once, so it is guarded here.
console.log('\n=== client half (classic-script shape) ===');
{
  const source = await import('node:fs/promises').then((fs) => fs.readFile('D:/dsh_pludge/lib/client.js', 'utf8'));
  const esm = /^\s*(?:import|export)\s/m.exec(source);
  console.log('ESM statements :', esm === null ? 'none' : `FOUND -> ${JSON.stringify(esm[0].trim())}`);
  if (esm !== null) problems.push(`client.js contains an ESM statement (${esm[0].trim()}), which is a syntax error in the classic-script plugin table`);

  let loaded;
  const fakeWindow = { __ModuleLoader__: { load: (entry) => { loaded = entry; } } };
  const registered = [];
  try {
    // eslint-disable-next-line no-new-func -- deliberately evaluating the bundle the way the renderer does
    new Function('window', `${source}\n`)(fakeWindow);
  } catch (error) {
    problems.push(`client.js failed to evaluate as a classic script: ${error.message}`);
  }
  console.log('module id      :', loaded?.id ?? '(load() never called)');
  if (loaded?.id !== 'dsh-gearbox') problems.push('client.js did not register under the module id "dsh-gearbox"');
  if (typeof loaded?.factory !== 'function') {
    problems.push('client.js factory is not a function');
  } else {
    // A minimal React stub: enough to run the component function, which is the
    // point — invoking it catches render-time mistakes that no syntax check can.
    const elements = [];
    const reactStub = {
      createElement: (type, props, ...children) => {
        const element = { type, props: props ?? {}, children };
        elements.push(element);
        if (typeof type === 'function') return type(props ?? {});
        return element;
      },
      // 组件用了 hooks：桩只求"能跑完渲染函数"，不真正管理状态
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
    };
    const client = loaded.factory((id) => (id === 'react' ? reactStub : undefined));
    console.log('exports        :', Object.keys(client).join(', '));
    console.log('inject         :', JSON.stringify(client.inject));
    if (typeof client.apply !== 'function') problems.push('client half has no apply()');
    if (!Array.isArray(client.inject)) problems.push('client half inject must be an array');
    if (!client.inject.includes('slots')) {
      problems.push('client half does not inject the slots service, so no settings section can be registered');
    }

    // The two inject maps are NOT the same vocabulary, and confusing them takes
    // the whole app down: the entry parks with `pending (waiting for services:
    // @deepseek-ai/…)` and the web boot asserts every entry activated, so the app
    // refuses to start. `lib/client.js` names SERVICES; `package.json`
    // → `dsh.client.inject` names PACKAGES (module seeds).
    const clientPackageIds = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile('D:/dsh_pludge/package.json', 'utf8')),
    )?.dsh?.client?.inject ?? [];
    console.log('manifest pkgs  :', JSON.stringify(clientPackageIds));
    const SERVICE_PACKAGES = {
      slots: '@deepseek-ai/dsh-client-ui-slots',
      locale: '@deepseek-ai/dsh-client-locale',
    };
    for (const name of client.inject) {
      if (name.includes('@') || name.includes('/')) {
        problems.push(`client inject "${name}" looks like a package id; this map takes service names (it would park the entry and block app boot)`);
        continue;
      }
      const pkg = SERVICE_PACKAGES[name];
      if (pkg !== undefined && !clientPackageIds.includes(pkg)) {
        problems.push(`client injects service "${name}" but the manifest does not seed ${pkg}`);
      }
    }
    for (const pkg of clientPackageIds) {
      if (!pkg.startsWith('@deepseek-ai/dsh-client')) problems.push(`manifest client.inject lists a non-client package: ${pkg}`);
    }
    // The host half's inject is a third vocabulary (host service names).
    for (const name of Array.isArray(plugin.inject) ? plugin.inject : []) {
      if (name.includes('@') || name.includes('/')) problems.push(`host inject "${name}" looks like a package id, not a host service name`);
    }

    // The renderer's globals, which the section component reads.
    const globals = { window: { matchMedia: () => ({ matches: false }) }, document: { documentElement: { lang: 'zh', getAttribute: () => null, className: '' } } };
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

    const registered = [];
    const sections = [];
    const withTimeout = (promise) => promise;
    client.apply({
      logger: {
        info: (...args) => console.log('[client info]', ...args),
        warn: (...args) => console.log('[client warn]', ...args),
        debug: () => {},
      },
      locale: { register: (ns, language, dict) => registered.push({ ns, language, keys: Object.keys(dict).length }) },
      slots: {
        inject: (name, run) => run(),
        register: (options, component) => {
          sections.push({ options, component });
          return () => {};
        },
      },
      effect: (fn) => fn(),
      get: () => undefined,
    });
    console.log('locale dicts   :', registered.map((entry) => `${entry.ns}/${entry.language} (${entry.keys} keys)`).join(', '));
    if (registered.length < 2) problems.push('client half registered fewer than 2 locale dictionaries');
    if (registered.some((entry) => entry.ns !== 'dsh-gearbox')) problems.push('client locale registered under a foreign namespace');

    console.log('settings sections:', sections.map((s) => `${s.options.name}#${s.options.id} (order ${s.options.order})`).join(', ') || '(none)');
    if (sections.length === 0) {
      problems.push('client half registered no settings.section — the plugin would not appear in DSH settings');
    }
    for (const { options, component } of sections) {
      // 每个插槽各查各的契约：设置分节要有模型行；输入条控件只要渲染出开关。
      const EXPECT = {
        'settings.section': { id: 'dsh-gearbox', needles: ['GLM-5.3-Flash', '无思考档位'] },
        'conversation.input.left': { id: 'gearbox-optimize', needles: ['优化提示词'] },
        'conversation.input.dock': { id: 'gearbox-optimize', needles: ['优化提示词'] },
      };
      const expect = EXPECT[options.name];
      if (expect === undefined) problems.push(`section registered into an unexpected slot "${options.name}"`);
      else if (options.id !== expect.id) problems.push(`section id is "${options.id}", expected "${expect.id}" for ${options.name}`);
      if (typeof options.order !== 'number') problems.push('section order must be a number (the shell sorts by it)');
      const label = typeof options.label === 'function' ? options.label() : options.label;
      console.log(`  label        : ${JSON.stringify(label)}`);
      if (typeof label !== 'string' || label.trim().length === 0) problems.push('section label must be a non-empty string (the shell renders it in the nav)');
      // Run the component. A throw here is a blank settings section in the real app.
      // 桩的 useEffect 不执行，组件会停在"加载中"分支 —— 所以断言分两层：
      // 渲染不抛 + 模块源码里确有独立页/API 路径（真数据渲染走不到时也不漏检）。
      // 行为级渲染验证：桩出来的"伪 React"跑通 hooks，并用 fetch 桩喂真实形状的数据，
      // 从而覆盖**有数据**分支 —— 真实应用里，这一分支抛错的表现就是"设置面板一片空白"。
      {
        const hooks = [];
        const seenEffects = new Set();
        let cursor = 0;
        let tree = null;
        let renderError = null;
        // 必须渲染当前被测的那个组件实例：不然用的还是上一段测试留下的 noop hooks。
        let renderTarget = null;
        const doRender = () => {
          cursor = 0;
          try {
            tree = renderTarget();
            renderError = null;
          } catch (error) {
            renderError = error;
          }
        };
        const fakeReact = {
          createElement: (type, props, ...children) => {
            if (typeof type === 'function') return type(props ?? {});
            return { type, props: props ?? {}, children };
          },
          useState: (init) => {
            const i = cursor++;
            if (hooks[i] === undefined) hooks[i] = typeof init === 'function' ? init() : init;
            return [hooks[i], (next) => {
              hooks[i] = typeof next === 'function' ? next(hooks[i]) : next;
              doRender();
            }];
          },
          useEffect: (fn) => {
            const i = cursor++;
            if (seenEffects.has(i)) return;
            seenEffects.add(i);
            fn();
          },
        };

        // 数据形状取自真实端点（/gears/api/*），不猜字段名。
        const FIXTURES = {
          '/gears/api/info': {
            ok: true, routes: ['ujn'], rules: 1, applyMode: 'auto', thinkingCapable: { 'GLM-5.3-Flash': true, 'Qwen-Image-2.1': false },
            lastApply: { at: '2026-09-30T09:00:00.000Z', source: 'auto', changed: false, attempts: 1, applied: [], rejected: [] },
            lane: { providers: { ujn: { baseURL: 'https://x/v1', credentialRef: 'K' } }, roles: {}, defaultProvider: 'ujn', saveDir: '.dsh-gearbox', autoEnhance: true },
            imageProtocols: ['chat'], imageRoles: ['generator'],
          },
          '/gears/api/inventory': {
            ok: true,
            models: [
              { route: 'ujn', model: 'GLM-5.3-Flash', api: 'openai-responses', declaredReasoningEfforts: { off: null, high: 'high', max: 'max' }, capabilities: { efforts: ['off', 'high', 'max'] }, suggestedFit: ['glm-gateway'], suggested: ['glm-gateway', 'glm-zai'] },
              { route: 'ujn', model: 'Qwen-Image-2.1', api: 'openai-responses', declaredReasoningEfforts: null, capabilities: { efforts: null }, suggestedFit: [], suggested: [] },
            ],
          },
          '/gears/api/presets': {
            ok: true,
            presets: [{ id: 'glm-gateway', label: '智谱 GLM（经网关）', levels: { off: null, high: 'high', max: 'max' } }],
            vendors: [{ id: 'zhipu', label: '智谱（GLM）', models: [{ id: 'glm-gateway', label: '智谱 GLM（经网关）', gears: ['off', 'high', 'max'] }] }],
            protocols: ['openai-responses', 'openai-completions', 'anthropic-messages'],
          },
          '/gears/api/own-config': {
            ok: true,
            config: { applyMode: 'auto', rules: [{ route: 'ujn', model: 'GLM-5.3-Flash', preset: 'glm-gateway' }], customEfforts: [], image: { roles: { promptEnhancer: { provider: 'ujn', model: 'PE-T2I' } } } },
          },
        };
        const realFetch = globalThis.fetch;
        const fetched = [];
        globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: true, json: async () => FIXTURES[String(url)] ?? { ok: true } }; };

        const section = loaded.factory((id) => (id === 'react' ? Object.assign({}, reactStub, fakeReact) : undefined));
        const injected = [];
        section.apply({
          logger: { info: () => {}, warn: (...a) => console.log('[client warn]', ...a), debug: () => {} },
          locale: { register: () => {} },
          slots: { inject: (n, run) => run(), register: (o, c) => { injected.push({ o, c }); return () => {}; } },
          effect: (fn) => fn(),
          get: () => undefined,
        });
        const target = injected[injected.length - 1].c;

        // 取本次用伪 React 注册的、与当前插槽同名的实例；外层的 component 用的是 noop 桩。
        renderTarget = (injected.find((entry) => entry.o.name === options.name) || injected[injected.length - 1]).c;
        doRender();
        console.log(`  renders(empty): ${renderError ? 'THREW ' + renderError.message : 'ok'}`);
        // 等 fetch 链跑完，setState 会触发一次带数据的重渲染
        await new Promise((resolve) => setTimeout(resolve, 60));
        const flat = JSON.stringify(tree);
        if (renderError) {
          problems.push(`settings section threw on the data render: ${renderError.message}`);
        } else if (!flat || flat === 'null') {
          problems.push('settings section rendered nothing once data arrived');
        } else {
          console.log('  fetched      :', fetched.join(' '));
          console.log('  hooks        :', hooks.length, '| hooks[0]=', hooks[0] === null ? 'null' : 'set', '| effects:', [...seenEffects].join(','));
          console.log('  tree dump    :', flat.slice(0, 300));
          console.log(`  renders(data) : ok (${flat.length} bytes) | 含模型行: ${flat.includes('GLM-5.3-Flash')} | 含无思考档位提示: ${flat.includes('无思考档位')}`);
          for (const needle of (expect ? expect.needles : [])) {
            if (!flat.includes(needle)) problems.push(`${options.name} data render is missing "${needle}"`);
          }
        }
        globalThis.fetch = realFetch;
      }
    }
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

// ---- the settings page must serve valid HTML with a compilable script ----
// The page is one template literal whose script is interpolated into it, so a
// quoting mistake there is a *runtime* failure in the browser, invisible to
// `node --check` on the module. Compiling the served script here is what
// catches it. (A single-quoted HTML attribute inside a single-quoted JS string
// shipped once, for exactly that reason.)
console.log('\n=== settings page (/gears/ui) ===');
{
  const { settingsPage } = await import('file:///D:/dsh_pludge/lib/settings-page.js');
  const html = settingsPage();
  for (const marker of ['id="status"', 'id="lastApply"', 'id="models"', 'id="lane"', 'id="flash"']) {
    if (!html.includes(marker)) problems.push(`settings page is missing ${marker}`);
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  console.log('inline scripts   :', scripts.length);
  for (const [index, script] of scripts.entries()) {
    try {
      // eslint-disable-next-line no-new-func -- compile-only, same as a browser would
      new Function(script);
      console.log(`  script[${index}]    : compiles OK (${script.length} chars)`);
    } catch (error) {
      problems.push(`settings page script[${index}] does not compile: ${error.message}`);
    }
    // Every dynamic value must go through esc(); a nested template literal would
    // have been consumed by the outer one, silently producing broken JS.
    if (/\$\{[^}]*\}/.test(script)) problems.push(`settings page script[${index}] contains a template literal (the outer one already consumed it)`);
  }
  if (scripts.length < 2) problems.push('settings page should carry the theme init script and the page script');
  // The embedded form needs the theme handoff, or a dark shell gets a white panel.
  if (!html.includes('data-theme')) problems.push('settings page has no theme hook for the settings-section iframe');
  console.log('html bytes       :', html.length);
}

// 原生渲染的设置分节必须指向自己的数据与独立页路径（iframe 已弃用，不再产生嵌套滚动）。
{
  const source = await import('node:fs/promises').then((fs) => fs.readFile('D:/dsh_pludge/lib/client.js', 'utf8'));
  for (const needle of ['/gears/ui', 'own-config', 'protocol', 'settings.section']) {
    if (!source.includes(needle)) problems.push(`client.js is missing ${needle}`);
  }
  if (/createElement\(\s*[\"']iframe/.test(source)) problems.push('client.js still renders an iframe — that is what produced the double scrollbar');
}

console.log('\n=== applyRules -> written config ===');
for (const edit of calls.edits) {
  const rows = (edit.providers?.ujn?.models ?? []).filter((m) => m.reasoningEfforts).map((m) => ({ id: m.id, efforts: m.reasoningEfforts, compat: m.compat }));
  console.log(JSON.stringify(rows, null, 1));
}

// A patch row replaces the entry's whole `config` key, so a partial write would
// silently delete a provider's connection facts. Assert every route the write
// touched still carries them.
console.log('\n=== non-destructive write check ===');
const expectedProfiles = { ...bundleLayer.providers, ...profileRow.providers };
let checkedRoutes = 0;
calls.edits.forEach((edit, index) => {
  for (const [route, written] of Object.entries(edit.providers ?? {})) {
    checkedRoutes += 1;
    const expected = expectedProfiles[route];
    const lost = ['baseURL', 'apiKeyEnv', 'api'].filter((key) => expected?.[key] !== undefined && JSON.stringify(written[key]) !== JSON.stringify(expected[key]));
    const home = Array.isArray(written.models) && written.models.length > 0 ? `models[] (${written.models.length})` : `modelOverrides (${Object.keys(written.modelOverrides ?? {}).length})`;
    console.log(`edit#${index} ${route.padEnd(16)} baseURL/apiKeyEnv/api ${lost.length === 0 ? 'preserved' : `LOST: ${lost.join(',')}`} · ${home}`);
    if (lost.length > 0) problems.push(`${route}: write dropped ${lost.join(', ')}`);
    // The two homes are mutually exclusive: the adapter rejects "sets
    // modelOverrides for X beside a models list".
    if (written.modelOverrides !== undefined && Array.isArray(written.models) && written.models.length > 0) {
      problems.push(`${route}: wrote modelOverrides beside a models list, which dsh-llm-pi-ai refuses`);
    }
  }
});
if (checkedRoutes === 0) problems.push('no route reached the written config');
if (calls.edits.length === 0) problems.push('configEditor.edit never ran');

// Mirrors dsh-llm-pi-ai's own admission rule: an efforts map that never leaves
// "off" is rejected outright, which would fail the whole config save. Also
// asserts each model's compat switches are ones its route protocol accepts —
// naming one it does not take fails resolution just as hard.
console.log('\n=== written config admission check (dsh-llm-pi-ai rules) ===');
for (const edit of calls.edits) {
  for (const [route, profile] of Object.entries(edit.providers ?? {})) {
    const rows = [
      ...(profile.models ?? []).map((model) => ({ id: model.id, model })),
      ...Object.entries(profile.modelOverrides ?? {}).map(([id, model]) => ({ id, model })),
    ];
    for (const { id, model } of rows) {
      const efforts = model.reasoningEfforts;
      if (!efforts) continue;
      const levels = Object.entries(efforts).filter(([, wire]) => wire !== null && wire !== undefined);
      if (levels.length === 0) problems.push(`${id}: reasoningEfforts offers no level beyond off`);
      console.log(`${id.padEnd(22)} api=${String(profile.api).padEnd(18)} ${levels.length} usable gear(s): ${levels.map(([gear, wire]) => `${gear}=${JSON.stringify(wire)}`).join(' ')}`);
      const violations = face?.problems?.(id, efforts) ?? [];
      if (violations.length > 0) problems.push(`admission: ${violations.join('; ')}`);
      if (profile.api === 'openai-responses') {
        for (const field of Object.keys(model.compat ?? {})) {
          problems.push(`${id}: compat "${field}" written on an openai-responses route, which does not take it`);
        }
      }
    }
  }
}

// The adaptation itself must be reported, not silent: a preset whose endpoint
// format cannot survive the route's protocol is exactly what the user needs told.
console.log('\n=== protocol adaptation notes ===');
const lastApply = face?.lastApply?.();
for (const row of lastApply?.applied ?? []) {
  console.log(`${row.route}/${row.model} (api=${row.routeApi}): ${row.notes?.length ? '' : 'no adaptation'}`);
  for (const note of row.notes ?? []) console.log(`    · ${note}`);
}
if ((lastApply?.applied ?? []).some((row) => row.notes?.length > 0) === false) {
  problems.push('expected a protocol adaptation note for the zai preset on the openai-responses ujn route');
}

// Completeness: every rule the plugin reported as applied must actually be
// present in the written config. Two rules aimed at one route used to race —
// the second rebuilt the route's model list from the pre-loop snapshot and
// silently dropped the first rule's row. Presence-only checks miss that.
console.log('\n=== write completeness (every applied rule must be in the config) ===');
const writtenByRoute = new Map();
for (const edit of calls.edits) {
  for (const [route, profile] of Object.entries(edit.providers ?? {})) {
    const rows = writtenByRoute.get(route) ?? new Set();
    for (const model of profile.models ?? []) {
      if (model.reasoningEfforts !== undefined) rows.add(model.id);
    }
    for (const [id, model] of Object.entries(profile.modelOverrides ?? {})) {
      if (model.reasoningEfforts !== undefined) rows.add(id);
    }
    writtenByRoute.set(route, rows);
  }
}
for (const row of lastApply?.applied ?? []) {
  const present = writtenByRoute.get(row.route)?.has(row.model) ?? false;
  console.log(`${row.route}/${row.model.padEnd(22)} ${present ? 'present' : 'MISSING from the written config'}`);
  if (!present) problems.push(`${row.model}: reported applied but absent from the written config`);
}
for (const route of writtenByRoute.keys()) {
  const wanted = (lastApply?.applied ?? []).filter((row) => row.route === route).length;
  const got = writtenByRoute.get(route).size;
  if (got < wanted) problems.push(`route ${route}: ${got} model(s) carried gears, expected at least ${wanted}`);
}

console.log('\n=== RESULT ===');
if (problems.length === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.log('PROBLEMS:');
  for (const problem of problems) console.log(' -', problem);
  process.exitCode = 1;
}
