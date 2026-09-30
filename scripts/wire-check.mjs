/**
 * Wire-shape check: from a profile's **written** llm-pi-ai config, derive the
 * exact request body dsh-llm-pi-ai + pi-ai would send for each selectable gear.
 *
 * This closes the last gap in Effort Studio's claim. The plugin's own tests
 * prove it writes a config the adapter admits; the adapter's live model info
 * proves the gears are advertised. Neither proves *what goes on the wire*.
 * That translation lives in two places this script replays faithfully:
 *
 *  1. `dsh-llm-pi-ai`'s `resolveModelReasoning` — turns a declared
 *     `reasoningEfforts` dict into pi-ai's `thinkingLevelMap`:
 *       declared level with a value -> that wire spelling
 *       declared `off` with no value -> key absent ("on, but send nothing")
 *       level absent from the dict    -> pinned to `null` ("unsupported")
 *       `reasoningEfforts: false`     -> the model is not a reasoning model
 *
 *  2. pi-ai's `openai-responses` `buildParams` — reads the map:
 *       gear selected  -> reasoning = { effort: map[gear] ?? gear, summary: "auto" }
 *                         plus include: ["reasoning.encrypted_content"]
 *       gear off, or none picked
 *                      -> reasoning = { effort: map.off ?? "none" }  (skipped only
 *                         when the map pins `off` to null, which the adapter
 *                         never emits — it omits the key instead)
 *
 * The `off` row is worth reading twice: "off" reaches the wire as
 * `reasoning.effort: "none"`, because dsh-llm-pi-ai drops the effort argument
 * for `off` and pi-ai then falls through to its no-effort branch. That is the
 * correct Responses spelling for "stop thinking" — not an omission bug.
 *
 * Run: node scripts/wire-check.mjs [profileDir]
 *   profileDir defaults to <DSH_HOME>/profiles/gearbox-check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const dshHome = process.env.USERPROFILE ?? process.env.HOME ?? '.';
const profileDir = process.argv[2] ?? join(dshHome, '.dsh', 'profiles', 'gearbox-check');

// `js-yaml` is not a dependency of this repo — it ships with the DSH runtime
// closure, which is also where the config being checked lives. Resolve it there
// so the script reads the same YAML dialect the Harness does.
async function loadYaml() {
  const candidates = [
    join(dshHome, '.dsh', 'profiles', 'node_modules', 'js-yaml', 'index.js'),
    join(profileDir, 'node_modules', 'js-yaml', 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      return (await import(pathToFileURL(candidate).href)).default;
    } catch {
      /* try the next candidate */
    }
  }
  console.error('wire-check: could not locate js-yaml in the DSH closure; is DSH installed?');
  process.exit(2);
}
const yaml = await loadYaml();
const patchPath = join(profileDir, 'cordis.patch.yml');
const rows = yaml.load(readFileSync(patchPath, 'utf8'));

const piAi = rows.find((row) => row.id === 'llm-pi-ai');
if (piAi === undefined) {
  console.error(`no llm-pi-ai row in ${patchPath}`);
  process.exit(1);
}

/** dsh-llm-pi-ai's resolveModelReasoning, reduced to the map it builds. */
function thinkingLevelMap(efforts) {
  if (efforts === undefined) return { reasoning: 'catalog default (entry declares nothing)' };
  if (efforts === false) return { reasoning: false };
  const map = {};
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level];
    if (wire === undefined) map[level] = null;
    else if (wire !== null) map[level] = wire;
  }
  return { reasoning: true, map };
}

/** pi-ai openai-responses buildParams, reduced to its reasoning block. */
function responsesBody(map, selectedGear) {
  if (selectedGear !== undefined) {
    return {
      reasoning: { effort: map[selectedGear] ?? selectedGear, summary: 'auto' },
      include: ['reasoning.encrypted_content'],
    };
  }
  if (map.off !== null) return { reasoning: { effort: map.off ?? 'none' }, include: ['reasoning.encrypted_content'] };
  return {};
}

console.log(`profile : ${profileDir}`);
console.log('route   :', Object.keys(piAi.config?.providers ?? {}).join(', '));

for (const [route, profile] of Object.entries(piAi.config?.providers ?? {})) {
  // A route's model fields live either on its `models` entries (a hand-declared
  // route) or in `modelOverrides` (a catalog-backed route). The adapter refuses
  // both at once, so read whichever the route actually used.
  const rows = [
    ...(profile.models ?? []),
    ...Object.entries(profile.modelOverrides ?? {}).map(([id, model]) => ({ id, ...model })),
  ];
  for (const model of rows) {
    if (model.reasoningEfforts === undefined) continue;
    const resolved = thinkingLevelMap(model.reasoningEfforts);
    console.log(`\n=== ${route}/${model.id} (api=${profile.api}) ===`);
    console.log('declared reasoningEfforts :', JSON.stringify(model.reasoningEfforts));
    if (model.compat !== undefined) console.log('declared compat          :', JSON.stringify(model.compat));
    if (resolved.reasoning === false) {
      console.log('resolved                 : non-reasoning model');
      continue;
    }
    console.log('resolved thinkingLevelMap:', JSON.stringify(resolved.map));
    if (profile.api !== 'openai-responses') {
      const selectable = Object.entries(resolved.map).filter(([, wire]) => wire !== null);
      console.log('selectable gears         :', selectable.map(([gear, wire]) => `${gear} -> ${JSON.stringify(wire)}`).join(', '));
      console.log('protocol                 : not openai-responses; body shape depends on compat.thinkingFormat');
      continue;
    }
    const selectable = Object.entries(resolved.map).filter(([, wire]) => wire !== null).map(([gear]) => gear);
    for (const gear of selectable) {
      console.log(`  gear ${gear.padEnd(7)} -> ${JSON.stringify(responsesBody(resolved.map, gear))}`);
    }
    console.log(`  gear ${'off'.padEnd(7)} -> ${JSON.stringify(responsesBody(resolved.map, undefined))}   (also the no-gear default)`);
  }
}
