/**
 * Live endpoint probe: does this route's endpoint actually honour the reasoning
 * fields the plugin writes?
 *
 * Effort Studio's preset library encodes a claim — "send `reasoning.effort`,
 * and this endpoint will obey it". Nothing local can settle that claim: a
 * gateway may accept the field and ignore it. This script answers it against
 * the real endpoint, which is the one thing the plugin cannot test for itself.
 *
 * It sends a minimal prompt twice per gear: once with the gear's wire value and
 * once with a deliberately invalid effort. An endpoint that honours the field
 * rejects (or visibly changes behaviour on) the invalid one; an endpoint that
 * ignores it answers both identically. That difference is the signal.
 *
 * The credential is read from the DSH credential store and never printed.
 *
 * Run: node scripts/probe-endpoint.mjs <route> <model> [gear ...]
 *   e.g. node scripts/probe-endpoint.mjs ujn GLM-5.3-Flash high
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dshHome = process.env.USERPROFILE ?? process.env.HOME ?? '.';
const home = join(dshHome, '.dsh');

const [route, model, ...gears] = process.argv.slice(2);
if (route === undefined || model === undefined) {
  console.error('usage: node scripts/probe-endpoint.mjs <route> <model> [gear ...]');
  process.exit(2);
}
const wanted = gears.length > 0 ? gears : ['high'];

async function loadYaml() {
  const candidates = [
    join(home, 'profiles', 'node_modules', 'js-yaml', 'index.js'),
    join(home, 'profiles', 'gearbox-check', 'node_modules', 'js-yaml', 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      return (await import(pathToFileURL(candidate).href)).default;
    } catch {
      /* next */
    }
  }
  throw new Error('js-yaml not found in the DSH closure');
}

/** The desktop profile is the source of truth for route connection facts. */
function routeProfile(name) {
  for (const profile of ['gearbox-check', 'desktop']) {
    const path = join(home, 'profiles', profile, 'cordis.patch.yml');
    let rows;
    try {
      rows = yaml.load(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    const found = rows?.find((row) => row.id === 'llm-pi-ai')?.config?.providers?.[name];
    if (found !== undefined) return { profile, provider: found };
  }
  throw new Error(`route "${name}" not found in any profile's llm-pi-ai providers`);
}

/** Read one credential out of the DSH store. The value never reaches stdout. */
function credential(ref) {
  const text = readFileSync(join(home, '.credentials.yaml'), 'utf8');
  const match = new RegExp(`^\\s*${ref}\\s*:\\s*(\\S+?),?\\s*$`, 'm').exec(text);
  if (match === null) throw new Error(`credential "${ref}" not found in the DSH store`);
  return match[1];
}

/** Per-request budget. A busy gateway can sit on one reasoning request forever. */
const REQUEST_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 45000);

const yaml = await loadYaml();
const { profile, provider } = routeProfile(route);
const apiKey = credential(provider.apiKeyEnv);
const base = String(provider.baseURL).replace(/\/+$/, '');
const declared = (provider.models ?? []).find((entry) => entry.id === model)?.reasoningEfforts ?? {};

console.log(`route     : ${route} (from the ${profile} profile)`);
console.log(`endpoint  : ${base}`);
console.log(`protocol  : ${provider.api}`);
console.log(`model     : ${model}`);
console.log(`declared  : ${JSON.stringify(declared)}`);
console.log(`key       : <read from ${provider.apiKeyEnv}, length ${apiKey.length}, not shown>`);
console.log();

/** One minimal request; returns the shape of what came back, never the key. */
async function ask(effort, label) {
  const body = {
    model,
    input: 'Reply with the single word: ok',
    reasoning: { effort, summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 64,
    stream: false,
  };
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      // A probe must not be able to hang: a reasoning model on a busy gateway can
      // sit on one request indefinitely, and the whole point of this script is to
      // come back with a verdict for every gear.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.log(`${label.padEnd(22)} ${timedOut ? `no answer within ${REQUEST_TIMEOUT_MS}ms` : `transport error: ${String(error?.message ?? error)}`}`);
    return { transport: timedOut ? 'timeout' : 'error' };
  }
  const text = await res.text();
  const ms = Date.now() - started;
  let json;
  try { json = JSON.parse(text); } catch { /* leave undefined */ }
  const reasoningTokens = json?.usage?.output_tokens_details?.reasoning_tokens ?? json?.usage?.reasoning_tokens;
  const outText = json?.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? '').join('') ?? '';
  const err = json?.error?.message ?? (res.ok ? undefined : text.slice(0, 160));
  console.log(`${label.padEnd(22)} http=${res.status} ${String(ms).padStart(5)}ms reasoning_tokens=${reasoningTokens ?? '-'} text=${JSON.stringify(outText.slice(0, 40))}${err === undefined ? '' : ` error=${JSON.stringify(err)}`}`);
  return { status: res.status, reasoningTokens, err };
}

console.log('--- asking ---');
const results = {};
for (const gear of wanted) {
  const wire = declared[gear] ?? gear;
  results[gear] = await ask(wire, `gear ${gear} = ${JSON.stringify(wire)}`);
}
// A wire value no endpoint should accept. Honouring the field means refusing
// this; ignoring the field means answering it like any other request.
results.invalid = await ask('definitely-not-an-effort', 'invalid effort');

console.log('\n--- reading ---');
const invalidRejected = results.invalid?.status !== undefined && results.invalid.status >= 400;
if (invalidRejected) {
  console.log('endpoint REJECTS an unknown effort -> it parses and validates reasoning.effort.');
  console.log('The gears the plugin writes therefore reach a field this endpoint acts on.');
} else {
  console.log('endpoint ACCEPTED an unknown effort -> it may ignore reasoning.effort entirely.');
  console.log('Verify by comparing reasoning_tokens between gears; if they are identical, the');
  console.log('endpoint is not honouring the field and the gears need a different mechanism.');
}
