/**
 * Probe what an OpenAI-compatible endpoint actually returns for an image model.
 *
 * The image lane has to parse a response it cannot control, and the shapes in
 * the wild disagree: `data[0].b64_json`, `data[0].url`, `choices[0].message.images`,
 * `message.content[].image_url`, `images[0].url`. Guessing wrong fails at the
 * last step of a slow, paid request. This prints the real shape instead.
 *
 * It also reports which paths exist at all, because a route configured for one
 * protocol does not imply the endpoint only serves that one.
 *
 * The credential is read from the DSH credential store and never printed.
 *
 * Run: node scripts/probe-image-endpoint.mjs <route> <model> [prompt]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dshHome = process.env.USERPROFILE ?? process.env.HOME ?? '.';
const home = join(dshHome, '.dsh');

const [route, model, prompt = 'a serene mountain lake at dawn, cinematic'] = process.argv.slice(2);
if (route === undefined || model === undefined) {
  console.error('usage: node scripts/probe-image-endpoint.mjs <route> <model> [prompt]');
  process.exit(2);
}

async function loadYaml() {
  for (const candidate of [
    join(home, 'profiles', 'node_modules', 'js-yaml', 'index.js'),
    join(home, 'profiles', 'gearbox-check', 'node_modules', 'js-yaml', 'index.js'),
  ]) {
    try {
      return (await import(pathToFileURL(candidate).href)).default;
    } catch {
      /* next */
    }
  }
  throw new Error('js-yaml not found in the DSH closure');
}

function routeProfile(name) {
  for (const profile of ['gearbox-check', 'desktop']) {
    let rows;
    try {
      rows = yaml.load(readFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), 'utf8'));
    } catch {
      continue;
    }
    const found = rows?.find((row) => row.id === 'llm-pi-ai')?.config?.providers?.[name];
    if (found !== undefined) return found;
  }
  throw new Error(`route "${name}" not found`);
}

function credential(ref) {
  const text = readFileSync(join(home, '.credentials.yaml'), 'utf8');
  const match = new RegExp(`^\\s*${ref}\\s*:\\s*(\\S+?),?\\s*$`, 'm').exec(text);
  if (match === null) throw new Error(`credential "${ref}" not found`);
  return match[1];
}

const yaml = await loadYaml();
const provider = routeProfile(route);
const apiKey = credential(provider.apiKeyEnv);
const base = String(provider.baseURL).replace(/\/+$/, '');

console.log(`route    : ${route}  (api=${provider.api})`);
console.log(`endpoint : ${base}`);
console.log(`model    : ${model}`);
console.log(`key      : <from ${provider.apiKeyEnv}, not shown>\n`);

/** Describe a response body's shape without dumping megabytes of base64. */
function describe(body) {
  const lines = [];
  const walk = (node, path, depth) => {
    if (depth > 5) return;
    if (Array.isArray(node)) {
      lines.push(`${path}[] length=${node.length}`);
      if (node.length > 0) walk(node[0], `${path}[0]`, depth + 1);
      return;
    }
    if (node === null || typeof node !== 'object') {
      const text = typeof node === 'string' ? (node.startsWith('data:') ? `<data-url ${node.length} chars, ${node.slice(0, 34)}…>` : node.slice(0, 60)) : String(node);
      lines.push(`${path} = ${text}`);
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, path === '' ? key : `${path}.${key}`, depth + 1);
  };
  walk(body, '', 0);
  return lines;
}

async function attempt(label, path, payload) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.log(`--- ${label} (${path}) ---\ntransport error: ${String(error?.message ?? error)}\n`);
    return;
  }
  const text = await res.text();
  const ms = Date.now() - started;
  console.log(`--- ${label} (${path}) --- http=${res.status} ${ms}ms ${text.length}B`);
  if (!res.ok) {
    console.log(`body: ${text.slice(0, 400)}\n`);
    return;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.log(`non-JSON body: ${text.slice(0, 200)}\n`);
    return;
  }
  for (const line of describe(body)) console.log(`  ${line}`);
  console.log();
}

await attempt('chat.completions', '/chat/completions', {
  model,
  stream: false,
  messages: [{ role: 'user', content: prompt }],
});

await attempt('responses', '/responses', {
  model,
  input: prompt,
  stream: false,
});
