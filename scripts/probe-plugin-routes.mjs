/**
 * Probe a running DSH instance's gearbox routes.
 *
 * Works against the isolated verification profile (boot it with `--no-open
 * --port 3399`, from which the token is read out of the boot log) or against a
 * live desktop instance (pass the base URL; its routes answer without a token).
 *
 * Uses fetch rather than curl for one specific reason: Git Bash rewrites
 * leading-slash arguments like `/gears/api/info` into Windows paths before curl
 * ever sees them, which silently turns a route probe into a file-not-found.
 *
 * Run: node scripts/probe-plugin-routes.mjs [baseUrl] [bootLog]
 *   node scripts/probe-plugin-routes.mjs                                   # isolated instance on :3399
 *   node scripts/probe-plugin-routes.mjs http://127.0.0.1:19387           # live desktop instance
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:3399';
const bootLog = process.argv[3] ?? 'D:/dsh_pludge/.workbuddy/tmp/gearbox-check-boot.log';

/** The token the web app prints into its own URL, when the instance needs one. */
function readToken() {
  if (!existsSync(bootLog)) return undefined;
  const log = readFileSync(bootLog, 'utf8');
  return /token=([A-Za-z0-9_-]+)/.exec(log)?.[1];
}

const token = readToken();
const query = token === undefined ? '' : `?token=${token}`;

const get = async (path) => {
  const res = await fetch(`${base}${path}${query}`, { redirect: 'manual' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
};

console.log(`base  : ${base}`);
console.log(`token : ${token === undefined ? '(none — desktop instances answer unauthenticated)' : `${token.slice(0, 8)}…`}`);

const info = await get('/gears/api/info');
if (info.status !== 200 || info.json?.ok !== true) {
  console.log(`\n/gears/api/info -> ${info.status}${info.text ? ` ${info.text.slice(0, 120)}` : ''}`);
  console.log('The plugin is not mounted on this instance (or is still parked waiting for services).');
  process.exit(1);
}

const j = info.json;
console.log('\n=== plugin state ===');
console.log('presets       :', j.presets);
console.log('protocols     :', (j.protocols ?? []).join(', '));
console.log('rules         :', j.rules, '| applyMode:', j.applyMode);
console.log('routes        :', (j.routes ?? []).join(', '));
console.log('commands      :', j.commandSurface, '|', (j.commands ?? []).join(', ') || 'none');
console.log('lastApply     :', JSON.stringify(j.lastApply));
const lane = j.lane?.providers?.[j.lane?.defaultProvider];
console.log('lane          : default=', j.lane?.defaultProvider, '| gen=', lane?.generator, '| PE-T2I=', lane?.promptEnhancer, '| PE-I2I=', lane?.editEnhancer, '| style=', lane?.style);

const inventory = await get('/gears/api/inventory');
console.log('\n=== models, declared vs actually advertised (what the composer renders) ===');
for (const row of inventory.json?.models ?? []) {
  const advertised = row.capabilities?.efforts
    ?? (row.capabilities?.error === undefined ? null : `ERROR ${row.capabilities.error}`);
  console.log(`${row.route}/${row.model.padEnd(22)} api=${String(row.api).padEnd(18)} declared=${JSON.stringify(row.declaredReasoningEfforts)} advertised=${JSON.stringify(advertised)}`);
  if (row.suggestedFit?.length > 0 && row.suggestedFit.length !== row.suggested.length) {
    console.log(`${' '.repeat(4)}protocol-fit presets lead: ${row.suggestedFit.slice(0, 3).join(', ')}`);
  }
}

const presetResult = await get('/gears/api/presets');
console.log('\n=== preset library ===');
console.log((presetResult.json?.presets ?? []).map((preset) => preset.id).join(', '));
