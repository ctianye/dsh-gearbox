/**
 * dsh-gearbox host half.
 *
 * Two seams, no LLM adapter of its own:
 *
 *  - **Effort Studio** reads the live `llm-pi-ai` entry through the
 *    configEditor service and writes `reasoningEfforts` / `compat`
 *    fragments into it. dsh-llm-pi-ai's configuration is volatile, so a
 *    written change reaches the next request without a restart.
 *  - **Image Lane** registers the `image_generate` tool, a local HTTP route
 *    for the settings panel, and the provider pipeline (prompt enhancer →
 *    generator → save).
 *
 * Every service this reads is injected by name; a composition without one
 * simply leaves that half dormant instead of failing activation.
 */
import { isDeepStrictEqual } from 'node:util';
import { Config } from './config.js';
import {
  PRESETS,
  PROTOCOLS,
  PROTOCOL_COMPAT_FIELDS,
  adaptToProtocol,
  presetById,
  presetsForModel,
  presetToFragments,
  presetToRouteFragments,
  presetToYamlLines,
  protocolNotes,
  reasoningEffortsProblems,
  THINKING_LEVELS,
} from './presets.js';
import { registerImageLane } from './image-lane.js';
import { settingsPage } from './settings-page.js';
import { isThinkingCapable, vendorTree } from './vendor-catalog.js';

export const name = 'dsh-gearbox';

/**
 * Injected services, all verified against the live Host Service catalog.
 *
 * A flat array, deliberately. Cordis's inject parser reads an array of service
 * names; the `{ required, optional }` object form that reads naturally here is
 * **not** resolved by this cordis build — it is taken as a request for services
 * literally named `required` and `optional`, so the entry parks forever with
 * `pending (waiting for services: required, optional)` and its routes never
 * register. A composition missing any of these parks the plugin rather than
 * half-mounting it; every name below ships in `@deepseek-ai/dsh-base`, which
 * every profile stack includes.
 */
export const inject = ['configEditor', 'tools', 'webServer', 'credentials', 'llm', 'commands'];

export { Config };

/** The llm-pi-ai package name this plugin configures. */
const PI_AI = '@deepseek-ai/dsh-llm-pi-ai';

/** The loader entry id the shipped profiles and docs use for that package. */
const PI_AI_ID = 'llm-pi-ai';

/** This plugin's package name, for addressing its own loader entry. */
const NAME = 'dsh-gearbox';

/** Find the live llm-pi-ai loader entry, or undefined when not mounted. */
function piAiEntry(ctx) {
  return findEntry(ctx, PI_AI, PI_AI_ID);
}

/**
 * Find a live loader entry by package name or row id.
 *
 * Used for `llm-pi-ai` (the config Effort Studio writes) and for this plugin's
 * own entry (the config the settings page writes back — rules and image roles
 * are this plugin's own settings, so the page edits them in place rather than
 * asking the user to hand-edit a patch file).
 */
function findEntry(ctx, packageName, rowId) {
  const editor = ctx.get('configEditor');
  if (editor === undefined) return undefined;
  try {
    return editor.entries().find((entry) =>
      entry.options?.name === packageName || entry.name === packageName || entry.options?.id === rowId);
  } catch {
    return undefined;
  }
}

/**
 * The effective providers dict: bundle-layer routes overlaid by profile routes.
 *
 * The overlay matters because a patch row **replaces** the entry's `config`
 * key outright (`cordis-plugin-include` assigns `target[key] = value`, it does
 * not deep-merge). A route declared only in the bundle layer is therefore not
 * visible to `config` alone, and writing a partial provider profile back would
 * silently drop that route's `baseURL` / `apiKeyEnv` / `api`. Merging both
 * layers here is what keeps a write non-destructive.
 */
/**
 * Short route-id suffix per protocol, for auto-created provider rows.
 */
const API_SUFFIX = {
  'openai-completions': 'completions',
  'openai-responses': 'responses',
  'anthropic-messages': 'anthropic',
};

/**
 * Move models onto providers whose `api` matches the plan.
 *
 * `llm-pi-ai` types `api` on the **provider**, so a per-model protocol choice is
 * realised by regrouping: the models that keep the route's own protocol stay
 * where they are, and each other protocol group moves to a cloned route
 * (`<route>-<suffix>`) that copies the connection facts (`baseURL`,
 * `apiKeyEnv`, headers) and swaps `api`.
 *
 * Routes that carry only `modelOverrides` (no `models` list) have no per-model
 * entries to move, so they pass through untouched.
 *
 * @param {Record<string, object>} providers  merged provider profiles
 * @param {Record<string, string>} plan       model id -> target protocol
 * @returns {Record<string, object>}
 */
function splitProvidersByProtocol(providers, plan) {
  const out = {};
  for (const [route, profile] of Object.entries(providers ?? {})) {
    const models = Array.isArray(profile.models) ? profile.models : [];
    if (models.length === 0) {
      out[route] = profile;
      continue;
    }
    const groups = new Map();
    for (const model of models) {
      const target = plan?.[model?.id] ?? profile.api;
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(model);
    }
    for (const [api, group] of groups) {
      if (api === profile.api || api === undefined) {
        const bucket = out[route] ?? { ...profile, models: [] };
        out[route] = bucket;
        bucket.models.push(...group);
        continue;
      }
      let id = `${route}-${API_SUFFIX[api] ?? api.replace(/[^a-z0-9]+/gi, '-')}`;
      while (out[id] !== undefined) id = `${id}-2`;
      const { models: _moved, modelOverrides: _kept, api: _old, ...connection } = profile;
      out[id] = { ...connection, api, displayName: `${profile.displayName ?? route} · ${(API_SUFFIX[api] ?? api)}`, models: [...group] };
    }
  }
  return out;
}

function mergeProviders(inherited, current) {
  const merged = { ...(inherited?.providers ?? {}) };
  for (const [route, profile] of Object.entries(current?.providers ?? {})) {
    merged[route] = { ...(merged[route] ?? {}), ...profile };
  }
  return merged;
}

/** The merged providers dict of the live llm-pi-ai entry. */
function providers(ctx) {
  const editor = ctx.get('configEditor');
  const entry = piAiEntry(ctx);
  if (editor === undefined || entry === undefined) return {};
  try {
    const record = editor.configuration().find((candidate) => candidate.entry === entry);
    if (record === undefined) return {};
    return mergeProviders(record.inherited, record.override);
  } catch {
    return {};
  }
}

/** Build the model-entry fragments one rule resolves to. */
function fragmentsFor(rule) {
  if (rule.efforts !== undefined || rule.compat !== undefined) {
    return {
      ...(rule.efforts !== undefined ? { reasoningEfforts: rule.efforts } : {}),
      ...(rule.compat !== undefined ? { compat: rule.compat } : {}),
    };
  }
  const preset = presetById(rule.preset);
  if (preset === undefined) {
    throw new Error(`dsh-gearbox: unknown preset "${String(rule.preset)}"`);
  }
  return presetToFragments(preset, rule);
}

/** Route-level fragments one rule resolves to (currently only thinkingBudgets). */
function routeFragmentsFor(rule) {
  const preset = presetById(rule.preset);
  return preset === undefined ? {} : presetToRouteFragments(preset, rule);
}

/**
 * Pure rule resolution: derive the next llm-pi-ai config from the layers the
 * editor would hand a write.
 *
 * Kept pure and separate from the write so `applyMode: "auto"` can decide
 * whether a write is needed at all. That guard matters: the write triggers a
 * config reload, our own entry re-activates on reload, and auto-apply would
 * otherwise write forever.
 *
 * @returns `{ next, applied, rejected }`.
 */
function resolveRules(current, inherited, rules) {
  const next = structuredClone(current ?? {});
  const visible = mergeProviders(inherited, next);
  const provs = { ...(next.providers ?? {}) };
  const applied = [];
  const rejected = [];

  // Rules addressed at the same route must accumulate, not race. Each rule
  // resolves against one shared working copy of that route's model list and
  // route-level fragments; rebuilding from the pre-loop snapshot would make
  // every rule after the first silently discard its predecessors' write.
  const working = new Map();
  const routeExtras = new Map();

  /**
   * Where a route's model fields live.
   *
   * `dsh-llm-pi-ai` refuses the two homes together — "sets modelOverrides for X
   * beside a models list; models already replaces the served catalog" — so the
   * shape of the route decides, and getting it wrong fails the whole save:
   *
   *   models: [...]      a hand-declared route. `models` replaces the served
   *                      catalog, so the fields go on the model entry.
   *   (no models list)   a catalog-backed route. A new `models` entry would
   *                      shadow the catalog entry and lose its context window
   *                      and modalities, so only the changed fields go in
   *                      `modelOverrides[<id>]`.
   */
  const homeFor = (profile) => {
    const declared = Array.isArray(profile.models) && profile.models.length > 0;
    return declared ? { kind: 'models', value: [...profile.models] } : { kind: 'modelOverrides', value: { ...(profile.modelOverrides ?? {}) } };
  };

  for (const rule of rules ?? []) {
    const route = rule.route;
    if (typeof route !== 'string' || route.length === 0) {
      rejected.push({ model: rule.model ?? null, reason: 'rule has no route' });
      continue;
    }
    const profile = visible[route];
    if (profile === undefined) {
      rejected.push({ route, model: rule.model, reason: `route "${route}" is not declared by ${PI_AI} (bundle layer or profile patch)` });
      continue;
    }
    if (!working.has(route)) working.set(route, homeFor(profile));
    const home = working.get(route);
    let fragments;
    try {
      fragments = fragmentsFor(rule);
    } catch (error) {
      rejected.push({ route, model: rule.model, reason: String(error?.message ?? error) });
      continue;
    }
    // A route's protocol decides which compat switches it can carry at all.
    const routeApi = profile.api;
    const adapted = adaptToProtocol(fragments, routeApi);
    const preset = presetById(rule.preset);
    const notes = preset === undefined ? [] : protocolNotes(preset, routeApi, route);
    if (home.kind === 'modelOverrides') {
      notes.push('route declares no models list, so the fields were written to modelOverrides — the route must be described by the installed pi-ai catalog');
    }
    if (adapted.droppedCompat.length > 0) {
      notes.push(`dropped compat ${adapted.droppedCompat.join(', ')}: api "${routeApi}" does not take ${adapted.droppedCompat.length > 1 ? 'them' : 'it'} (only ${PROTOCOL_COMPAT_FIELDS[routeApi] === undefined ? 'no protocol' : [...PROTOCOL_COMPAT_FIELDS[routeApi]].join(', ')})`);
    }
    if (adapted.suspiciousGears.length > 0) {
      notes.push(`gears ${adapted.suspiciousGears.join(', ')} are format-specific tokens, but api "${routeApi}" sends them as reasoning.effort — verify the endpoint honours them, or declare an openai-completions route`);
    }

    let merged;
    if (home.kind === 'models') {
      const index = home.value.findIndex((model) => model?.id === rule.model);
      merged = index >= 0 ? { ...home.value[index], ...adapted.fragments } : { id: rule.model, ...adapted.fragments };
      const problems = reasoningEffortsProblems(rule.model, merged.reasoningEfforts);
      if (problems.length > 0) {
        rejected.push({ route, model: rule.model, problems });
        continue;
      }
      if (index >= 0) home.value[index] = merged;
      else home.value.push(merged);
    } else {
      merged = { ...(home.value[rule.model] ?? {}), ...adapted.fragments };
      const problems = reasoningEffortsProblems(rule.model, merged.reasoningEfforts);
      if (problems.length > 0) {
        rejected.push({ route, model: rule.model, problems });
        continue;
      }
      home.value[rule.model] = merged;
    }
    routeExtras.set(route, { ...(routeExtras.get(route) ?? {}), ...routeFragmentsFor(rule) });
    applied.push({
      route,
      model: rule.model,
      preset: rule.preset ?? null,
      routeApi: routeApi ?? null,
      target: home.kind,
      reasoningEfforts: merged.reasoningEfforts ?? null,
      notes,
    });
  }

  for (const [route, home] of working) {
    // Route-level fragments (thinkingBudgets) belong on the provider profile.
    provs[route] = {
      ...visible[route],
      [home.kind]: home.value,
      ...(routeExtras.get(route) ?? {}),
    };
  }
  next.providers = provs;
  return { next, applied, rejected };
}

/**
 * Apply Effort Studio rules to the llm-pi-ai entry override.
 *
 * `configEditor.edit` hands the callback `(current, inherited)`: `current` is
 * the entry's own config (the profile row, when one exists) and `inherited` is
 * the bundle layer beneath it. Because a returned config *replaces* the whole
 * `config` key, this writes a complete provider profile per touched route —
 * merged from both layers — rather than a partial fragment that would drop
 * `baseURL` / `apiKeyEnv`. Untouched routes and fields survive verbatim.
 *
 * Each resolved row is admitted locally first. `INVALID_CONFIG` fails the whole
 * save, so one bad rule would otherwise cost the user every other rule in the
 * same write; a rejected rule is reported instead of written.
 *
 * @returns `{ applied, rejected, changed }` — what was written, what was
 *   refused, and whether the stored config actually moved.
 */
async function applyRules(ctx, rules) {
  const editor = ctx.get('configEditor');
  if (editor === undefined) throw new Error('dsh-gearbox: the configEditor service is not mounted');
  const entry = piAiEntry(ctx);
  if (entry === undefined) {
    throw new Error(`dsh-gearbox: no ${PI_AI} entry is mounted; Effort Studio has nothing to configure`);
  }

  // Preview against the live entry so an idempotent rule set writes nothing.
  const record = editor.configuration().find((candidate) => candidate.entry === entry);
  const live = record?.override ?? entry.options?.config ?? {};
  const preview = resolveRules(live, record?.inherited, rules);
  if (isDeepStrictEqual(preview.next, live)) {
    return { applied: preview.applied, rejected: preview.rejected, changed: false };
  }

  let resolved = preview;
  await editor.edit(entry, (current, inherited) => {
    resolved = resolveRules(current, inherited, rules);
    return resolved.next;
  });
  return { applied: resolved.applied, rejected: resolved.rejected, changed: true };
}

/** YAML fragment a user can paste instead of letting the plugin write. */
function exportYaml(rules) {
  const blocks = [];
  for (const rule of rules ?? []) {
    const preset = presetById(rule.preset);
    if (preset === undefined) continue;
    blocks.push(presetToYamlLines(preset, rule.model, rule));
  }
  return blocks.join('\n\n');
}

/** Live model inventory across every llm-pi-ai route, for the panel. */
async function inventory(ctx) {
  const llm = ctx.get('llm');
  const provs = providers(ctx);
  const rows = [];
  for (const route of Object.keys(provs)) {
    const profile = provs[route] ?? {};
    const declared = (profile.models ?? []).map((model) => model?.id).filter(Boolean);
    let advertised = [];
    if (llm !== undefined) {
      try {
        advertised = (await llm.listModels(route)).map((model) => model.id);
      } catch {
        advertised = [];
      }
    }
    const ids = [...new Set([...declared, ...advertised])];
    for (const id of ids) {
      const configured = (profile.models ?? []).find((model) => model?.id === id);
      let capabilities;
      if (llm !== undefined) {
        try {
          const info = await llm.resolveModelInfo(route, id);
          capabilities = {
            efforts: info.reasoning?.efforts?.map((effort) => effort.id) ?? null,
            defaultEffort: info.reasoning?.defaultEffort ?? null,
            inputModalities: info.inputModalities ?? null,
            contextWindow: info.context?.contextWindow ?? null,
          };
        } catch (error) {
          capabilities = { error: String(error?.message ?? error) };
        }
      }
      rows.push({
        route,
        model: id,
        api: profile.api ?? null,
        declaredReasoningEfforts: configured?.reasoningEfforts ?? null,
        declaredCompat: configured?.compat ?? null,
        capabilities: capabilities ?? null,
        suggested: presetsForModel(id).map((preset) => preset.id),
        suggestedFit: presetsForModel(id, profile.api).map((preset) => preset.id),
      });
    }
  }
  return rows;
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ rules?: unknown[], applyMode?: string, image?: object }} config
 */
/**
 * The effective rule list from a config object.
 *
 * `rules` carries preset-driven entries; `customEfforts` / `customCompat` carry
 * hand-written ones. The two custom arrays are stored **flattened** —
 * `{ route, model, high: "high", … }` — because that is what the settings form
 * edits and what the schema's `z.intersect` describes, while `fragmentsFor`
 * wants `{ route, model, efforts: { … } }`. Normalising here keeps the config
 * shape human-editable and the resolver single-shaped.
 *
 * (These two arrays were declared in the schema and never consumed before, which
 * made them dead config: the settings form could write gear sets that silently
 * did nothing.)
 *
 * Custom entries come **after** preset rules so a hand-written gear set wins for
 * the same model — the form is the more specific intent.
 */
export function assembleRules(config) {
  return [
    ...(Array.isArray(config?.rules) ? config.rules : []),
    ...(Array.isArray(config?.customEfforts) ? config.customEfforts.map((entry) => {
      const { route, model, ...gears } = entry ?? {};
      return { route, model, efforts: gears };
    }) : []),
    ...(Array.isArray(config?.customCompat) ? config.customCompat.map((entry) => {
      const { route, model, ...compat } = entry ?? {};
      return { route, model, compat };
    }) : []),
  ];
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx, config) {
  const applyMode = config?.applyMode ?? 'auto';
  const image = config?.image ?? {};
  const rules = assembleRules(config);

  ctx.logger.info('dsh-gearbox: mounted (presets=%d, rules=%d, mode=%s)', PRESETS.length, rules.length, applyMode);

  /**
   * Outcome of the last Effort Studio write, surfaced through /gears/api/info.
   *
   * A rejected rule and an adaptation note are both silent to the user
   * otherwise: `configEditor` writes into the profile patch, and the failure
   * that matters (`INVALID_CONFIG`, a protocol that takes no `thinkingFormat`)
   * surfaces only as a logger line in a boot log nobody reads.
   */
  let lastApply = null;

  const record = (outcome) => {
    lastApply = { at: new Date().toISOString(), ...outcome };
    return lastApply;
  };

  const face = {
    presets: () => PRESETS,
    protocols: () => [...PROTOCOLS],
    thinkingLevels: () => [...THINKING_LEVELS],
    preset: (id) => presetById(id),
    forModel: (modelId, api) => presetsForModel(modelId, api),
    fragmentsFor: (rule) => fragmentsFor(rule),
    problems: (modelId, efforts) => reasoningEffortsProblems(modelId, efforts),
    applyRules: (list) => applyRules(ctx, list),
    exportYaml: (list) => exportYaml(list),
    inventory: () => inventory(ctx),
    routes: () => Object.keys(providers(ctx)),
    providers: () => providers(ctx),
    lastApply: () => lastApply,
    config: () => ({ rules, applyMode, image }),
  };

  // Provide the face as a service other plugins (and the client half, via
  // typed Remote later) can read. ctx.provide is fiber-owned and disposed
  // with the plugin.
  //
  // This is also the collision point of a **double mount**. Cordis does not
  // dedupe a plugin named by two patch layers, and the two mounts would fight
  // over every name this plugin claims — the `gearbox` service, the
  // `image_generate` tool, the `/gears/api` routes, the `/image` command. The
  // service is claimed first, so it is where the conflict surfaces.
  //
  // Reacting to the actual collision (rather than pre-checking the registry)
  // matters: on an HMR reload the previous mount may still be live while the
  // next one applies, and a pre-check would mistake that for a duplicate and
  // stand down — leaving the plugin registered by nobody once the old mount is
  // disposed. A genuine second mount cannot release this name, so only a real
  // duplicate throws here, and the fiber that owns the failure can simply stop.
  try {
    ctx.provide?.('gearbox', face);
  } catch (error) {
    ctx.logger.warn(
      'dsh-gearbox: the "gearbox" service is already claimed, so this entry stands down — '
      + 'something mounted dsh-gearbox twice (a bundle-layer row plus a hand-written profile row, or two insert '
      + 'rows). Only one row may mount it. Cause: %s',
      String(error?.message ?? error),
    );
    return;
  }

  // ---- Effort Studio: declared rules, applied on activation ----
  // `auto` means the profile's rule list is the source of truth and reaches
  // llm-pi-ai without a second visit to the settings page. The write is
  // idempotent (applyRules previews first), so re-activation on config reload
  // settles instead of looping. `manual` keeps activation read-only: rules are
  // still browsable and exportable, and reach the config only through an
  // explicit /gears/api/apply.
  if (applyMode === 'auto' && rules.length > 0) {
    ctx.effect(() => {
      let cancelled = false;
      let timer;

      /**
       * Run the write, waiting out an in-flight reload if necessary.
       *
       * `configEditor.edit` serializes itself through `hmr.runExclusive`, which
       * **cannot nest** — and activation frequently *is* a reload: an HMR or
       * patch-file refresh re-applies this entry, so a write issued straight
       * from `apply()` fails with "HMR transactions cannot be nested" and
       * silently leaves the config untouched.
       *
       * So the write is deferred off the activation stack and retried while
       * that specific refusal persists. The delays start short (a plain boot
       * settles in one tick) and stretch out, because a patch-file reload that
       * re-activates this entry can hold its transaction for seconds. Any other
       * failure is reported as-is rather than retried.
       */
      const RETRY_DELAYS_MS = [250, 1000, 1000, 1000, 1500, 2000, 3000, 3000, 5000, 5000, 8000];
      const attempt = async (step) => {
        try {
          const { applied, rejected, changed } = await applyRules(ctx, rules);
          if (cancelled) return;
          record({ source: 'auto', changed, applied, rejected, attempts: step + 1 });
          if (changed) {
            ctx.logger.info('dsh-gearbox: applied %d rule(s) to %s', applied.length, PI_AI);
          } else {
            ctx.logger.info('dsh-gearbox: %d rule(s) already in effect on %s', applied.length, PI_AI);
          }
          for (const row of applied) {
            for (const note of row.notes ?? []) {
              ctx.logger.warn('dsh-gearbox: %s/%s — %s', row.route, row.model, note);
            }
          }
          for (const miss of rejected) {
            ctx.logger.warn('dsh-gearbox: rule %s/%s skipped: %s', miss.route ?? '-', miss.model ?? '-', miss.problems?.join('; ') ?? miss.reason);
          }
        } catch (error) {
          const reason = String(error?.message ?? error);
          if (step + 1 < RETRY_DELAYS_MS.length && /transaction/i.test(reason)) {
            timer = setTimeout(() => { if (!cancelled) void attempt(step + 1); }, RETRY_DELAYS_MS[step + 1]);
            return;
          }
          if (cancelled) return;
          record({ source: 'auto', changed: false, applied: [], rejected: [], attempts: step + 1, error: reason });
          ctx.logger.warn('dsh-gearbox: auto-apply gave up after %d attempt(s): %s', step + 1, reason);
        }
      };

      timer = setTimeout(() => { if (!cancelled) void attempt(0); }, RETRY_DELAYS_MS[0]);
      return () => { cancelled = true; clearTimeout(timer); };
    }, 'dsh-gearbox: auto-apply rules');
  } else if (rules.length > 0) {
    ctx.logger.info('dsh-gearbox: %d rule(s) held back (applyMode=manual); POST /gears/api/apply to write them', rules.length);
  }

  // ---- Image Lane ----
  // The lane reports its own resolved configuration back, so /gears/api/info can
  // describe what is actually wired (providers, styles, enhancer roles) without
  // re-deriving it from the raw config — and without echoing any credential.
  let laneInfo = () => ({ providers: {} });
  let laneCommands = [];
  // 路由处理器需要调用 lane.enhance，而 lane 在下面 effect 的回调里创建，故留一个函数级引用。
  let laneApi = null;
  const commandSurface = ctx.get('commands') === undefined ? 'absent' : 'mounted';
  ctx.effect(() => {
    const lane = registerImageLane(ctx, { image });
    laneInfo = lane.laneInfo;
    laneCommands = lane.commands;
    laneApi = lane;
    return lane.dispose;
  }, 'dsh-gearbox: image lane');

  // ---- panel API ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/gears/api',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh.internal');
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      };
      try {
        if (req.method === 'GET' && url.pathname === '/gears/api/info') {
          send(200, {
            ok: true,
            presets: PRESETS.length,
            protocols: PROTOCOLS,
            rules: rules.length,
            applyMode,
            lastApply,
            routes: Object.keys(providers(ctx)),
            // Which configured models have a thinking control at all. The settings
            // page hides the gear dropdown for the rest — offering a dial an
            // endpoint does not have is worse than offering none.
            thinkingCapable: Object.fromEntries(
              Object.entries(providers(ctx)).flatMap(([, profile]) => (profile.models ?? []).map((model) => [model.id, isThinkingCapable(model.id)])),
            ),
            // Image Lane: providers are connection profiles; each role binds its
            // own model + protocol, which is what `lane.roles` reports.
            imageProviders: Object.keys(laneInfo().providers ?? {}),
            imageProtocols: laneInfo().protocols ?? [],
            imageRoles: Object.keys(laneInfo().roles ?? {}),
            defaultImageProvider: laneInfo().defaultProvider ?? null,
            autoEnhance: laneInfo().autoEnhance ?? true,
            lane: laneInfo(),
            commandSurface,
            commands: laneCommands,
            settingsPage: '/gears/ui',
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/gears/api/presets') {
          send(200, { ok: true, presets: PRESETS, vendors: vendorTree(PRESETS), protocols: PROTOCOLS });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/gears/api/inventory') {
          send(200, { ok: true, models: await inventory(ctx) });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/gears/api/rules') {
          send(200, { ok: true, rules, applyMode });
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = body.length > 0 ? JSON.parse(body) : {};
        if (req.method === 'POST' && url.pathname === '/gears/api/export') {
          send(200, { ok: true, yaml: exportYaml(input.rules ?? []) });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/gears/api/validate') {
          // Dry run: report what would be written and what would be refused,
          // without touching the profile.
          const list = input.rules ?? rules;
          const editor = ctx.get('configEditor');
          const entry = piAiEntry(ctx);
          const record = editor !== undefined && entry !== undefined
            ? editor.configuration().find((candidate) => candidate.entry === entry)
            : undefined;
          const preview = resolveRules(record?.override ?? entry?.options?.config ?? {}, record?.inherited, list);
          send(200, { ok: true, applied: preview.applied, rejected: preview.rejected, changed: !isDeepStrictEqual(preview.next, record?.override ?? entry?.options?.config ?? {}) });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/gears/api/apply') {
          const outcome = await applyRules(ctx, input.rules ?? []);
          send(200, { ok: true, ...record({ source: 'http', ...outcome }) });
          return;
        }
        /**
         * Per-model protocol switching.
         *
         * `llm-pi-ai` types `api` on the provider, so "this model speaks a
         * different protocol" is realised by regrouping models across routes —
         * see {@link splitProvidersByProtocol}. Generic on purpose: the same
         * dropdown serves text and image models, and no image-specific surface
         * exists.
         */
        if (req.method === 'POST' && url.pathname === '/gears/api/protocol') {
          // The prefix handler has already consumed the request body into `input`.
          const plan = input?.plan ?? {};
          // 文本协议写进 llm-pi-ai 的 `providers[].api`；图像协议是**本插件**的能力
          // （llm-pi-ai 不认它们），所以写进 image.roles，落到 Image Lane 的角色上。
          const IMAGE_ROLE_FOR = {
            'images-generations': 'generator',
            'images-edits': 'editor',
            'images-variations': 'variator',
          };
          const textPlan = {};
          const imagePlan = {};
          for (const [model, api] of Object.entries(plan)) {
            if (PROTOCOLS.includes(api)) textPlan[model] = api;
            else if (IMAGE_ROLE_FOR[api] !== undefined) imagePlan[model] = api;
            else {
              send(400, { ok: false, error: `未知协议：${model} → ${api}（可用：${[...PROTOCOLS, ...Object.keys(IMAGE_ROLE_FOR)].join(' / ')}）` });
              return;
            }
          }
          let imageWrites = null;
          if (Object.keys(imagePlan).length > 0) {
            // 模型所在的路由就是它的供应商（llm-pi-ai 的 providers 是唯一的来源）。
            const owners = providers(ctx);
            const own = findEntry(ctx, NAME, 'gearbox');
            if (own === undefined) {
              send(503, { ok: false, error: 'dsh-gearbox: 找不到本插件的配置条目，无法写入图像协议' });
              return;
            }
            const nextImage = structuredClone(image);
            nextImage.roles = { ...(nextImage.roles ?? {}) };
            for (const [model, api] of Object.entries(imagePlan)) {
              const route = Object.keys(owners).find((name) => (owners[name].models ?? []).some((entry) => entry.id === model));
              if (route === undefined) {
                send(400, { ok: false, error: `找不到模型 ${model} 所属的供应商` });
                return;
              }
              const role = IMAGE_ROLE_FOR[api];
              nextImage.roles[role] = { ...(nextImage.roles[role] ?? {}), provider: route, model, protocol: api };
            }
            const current = own.options?.config ?? {};
            await ctx.get('configEditor').edit(own, () => ({ ...current, image: nextImage }));
            imageWrites = Object.fromEntries(Object.entries(nextImage.roles).map(([role, binding]) => [role, `${binding.provider}/${binding.model} @ ${binding.protocol}`]));
          }

          if (Object.keys(textPlan).length === 0) {
            send(200, { ok: true, changed: imageWrites !== null, routes: null, image: imageWrites });
            return;
          }
          const entry = piAiEntry(ctx);
          if (entry === undefined) {
            send(503, { ok: false, error: `no ${PI_AI} entry is mounted` });
            return;
          }
          const editor = ctx.get('configEditor');
          const record = editor.configuration().find((candidate) => candidate.entry === entry);
          const live = mergeProviders(record?.inherited, record?.override ?? entry.options?.config ?? {});
          const planned = splitProvidersByProtocol(live, textPlan);
          const changed = !isDeepStrictEqual(planned, live);
          let routes = null;
          if (changed) {
            await editor.edit(entry, (current, inherited) => {
              const nextProviders = splitProvidersByProtocol(mergeProviders(inherited, current), textPlan);
              routes = Object.fromEntries(Object.entries(nextProviders).map(([route, profile]) => [route, {
                api: profile.api,
                models: (profile.models ?? []).map((model) => model.id),
              }]));
              return { ...current, providers: nextProviders };
            });
          }
          send(200, { ok: true, changed: changed || imageWrites !== null, routes, image: imageWrites });
          return;
        }
        /**
         * Prompt optimisation for the composer's "optimize" button.
         *
         * Runs only the enhancer half of the Image Lane — no image is generated.
         * The role it uses is the one bound in 图像通道 → 提示词优化模型, so the model
         * is configured once and shared by both the lane and the composer.
         */
        if (req.method === 'POST' && url.pathname === '/gears/api/enhance') {
          const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
          try {
            if (laneApi === null) throw new Error('dsh-gearbox: 图像通道尚未就绪（image lane not mounted），请检查插件配置');
            const result = await laneApi.enhance({ prompt, lane: input?.lane === 'edit' ? 'edit' : 't2i' });
            send(200, { ok: true, ...result });
          } catch (error) {
            send(502, { ok: false, error: String(error?.message ?? error) });
          }
          return;
        }
        send(404, { ok: false, error: `unknown gearbox route ${req.method} ${url.pathname}` });
      } catch (error) {
        send(500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }), 'dsh-gearbox: /gears/api routes');

  // ---- settings page ----
  // Served by the plugin itself rather than registered into the settings shell:
  // the shell's "配置 <name>" entry depends on the plugin manager's config ledger
  // and the Host's settings-describe RPC, neither of which a third-party plugin
  // controls, and what this page shows — per model, the gears configured versus
  // the gears the adapter actually advertises — is not a generic schema form.
  // Plain HTML on our own route cannot take the renderer down.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/gears/ui',
    handler: async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(settingsPage());
    },
  }), 'dsh-gearbox: settings page');

  // ---- this plugin's own config, read and written by the settings page ----
  // The page is a form editor: gear chips per model, and a per-role protocol
  // dropdown for the image lane. Both are this plugin's own settings, so the
  // page writes them back here instead of asking the user to hand-edit a patch.
  //
  // The write merges into the entry's **current** config rather than replacing
  // it, because a patch row's `config` is assigned wholesale — dropping
  // `applyMode` or an unrelated key would silently change behaviour.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/gears/api/own-config',
    handler: async (req, res) => {
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      };
      const entry = findEntry(ctx, NAME, 'gearbox');
      if (entry === undefined) {
        send(503, { ok: false, error: 'dsh-gearbox: this plugin\'s own loader entry was not found, so its config cannot be edited from the settings page' });
        return;
      }
      if (req.method === 'GET') {
        const current = entry.options?.config ?? {};
        send(200, { ok: true, config: {
          applyMode: current.applyMode ?? 'auto',
          rules: current.rules ?? [],
          customEfforts: current.customEfforts ?? [],
          customCompat: current.customCompat ?? [],
          image: current.image ?? {},
        } });
        return;
      }
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const patch = JSON.parse(raw || '{}');
        const current = entry.options?.config ?? {};
        // Only the sections the settings page edits; anything else passes through.
        const next = { ...current };
        for (const section of ['rules', 'customEfforts', 'customCompat', 'image', 'ui']) {
          if (patch[section] !== undefined) next[section] = patch[section];
        }
        await ctx.get('configEditor').edit(entry, () => next);

        /**
         * If the Effort Studio sections changed, push them to `llm-pi-ai`
         * **inside this request**.
         *
         * Doing it here rather than waiting for the deferred auto-apply is not an
         * optimisation. `configEditor.edit` opens an HMR transaction, and
         * `runExclusive` cannot nest — so a write issued from this entry's own
         * *activation* (which the edit just triggered) is refused with
         * "HMR transactions cannot be nested", and the retry budget can be spent
         * entirely inside that one transaction. A request handler, by contrast,
         * is not inside any transaction, which is exactly why `POST
         * /gears/api/apply` works.
         */
        let efforts = null;
        if (patch.rules !== undefined || patch.customEfforts !== undefined || patch.customCompat !== undefined) {
          try {
            efforts = await applyRules(ctx, assembleRules(next));
          } catch (error) {
            efforts = { applied: [], rejected: [], error: String(error?.message ?? error) };
          }
        }
        send(200, { ok: true, config: {
          applyMode: next.applyMode ?? 'auto',
          rules: next.rules ?? [],
          customEfforts: next.customEfforts ?? [],
          customCompat: next.customCompat ?? [],
          image: next.image ?? {},
        }, efforts });
      } catch (error) {
        send(502, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }), 'dsh-gearbox: own-config read/write');
}
