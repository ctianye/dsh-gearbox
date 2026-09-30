/**
 * Dev-link the DSH runtime closure a linked plugin needs.
 *
 * ## Why this exists
 *
 * A plugin's host half imports bare `@deepseek-ai/*` specifiers
 * (`@deepseek-ai/schemastery` for the Config schema, `@deepseek-ai/dsh-tools`
 * for `defineTool`). DSH ships that closure once per Harness home, at
 *
 *   <DSH_HOME>/profiles/node_modules/@deepseek-ai/*
 *
 * and Node finds it by walking `node_modules` upwards from the *realpath* of
 * the importing file.
 *
 * That walk works for a published plugin (`<DSH_HOME>/profiles/<p>/node_modules/
 * <pkg>` sits under the closure) — and it is why `dsh-better-sidebar` resolves
 * without any links of its own. It breaks only for a **linked dev package on a
 * different drive**: `D:\...\dsh-gearbox\lib\config.js` walks `D:\...\node_modules`
 * and never reaches `C:\Users\<user>\.dsh\profiles\node_modules`. The symptom is
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`.
 *
 * This script plants a `node_modules` inside the plugin directory holding a
 * junction per runtime package, so the walk succeeds. The junction target is a
 * realpath *inside* the closure, so the linked packages' own transitive imports
 * keep resolving normally.
 *
 * Dev-only: `node_modules/` is gitignored, and `package.json`'s `files`
 * whitelist keeps it out of the published tarball. Published installs need none
 * of this.
 *
 * Run: node scripts/setup-dev-links.mjs [--dsh-home <dir>]
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 插件已提升到仓库根目录：scripts/ 的上一级就是插件包本身。
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Runtime packages the plugin's host half resolves by bare specifier. */
const NEEDED = ['schemastery', 'dsh-tools', 'dsh-llm', 'cordis', 'cosmokit'];

function resolveDshHome(argv) {
  const flag = argv.indexOf('--dsh-home');
  if (flag >= 0 && argv[flag + 1]) return resolve(argv[flag + 1]);
  return join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh');
}

const dshHome = resolveDshHome(process.argv.slice(2));
const closure = join(dshHome, 'profiles', 'node_modules');
const target = join(PLUGIN, 'node_modules');

if (!existsSync(closure)) {
  console.error(`dsh-gearbox: no runtime closure at ${closure}`);
  console.error('Point at the right home with: --dsh-home <dir>');
  process.exit(1);
}

mkdirSync(join(target, '@deepseek-ai'), { recursive: true });

let linked = 0;
const missing = [];
for (const pkg of NEEDED) {
  const source = join(closure, '@deepseek-ai', pkg);
  if (!existsSync(source)) {
    missing.push(pkg);
    continue;
  }
  const link = join(target, '@deepseek-ai', pkg);
  // Re-point stale links; never clobber a real directory someone installed.
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isSymbolicLink()) continue;
    rmSync(link, { recursive: true, force: true });
  }
  symlinkSync(source, link, 'junction');
  linked += 1;
}

console.log(`dsh-gearbox: dev links ready in ${target}`);
console.log(`  closure : ${closure}`);
console.log(`  linked  : ${linked}/${NEEDED.length}`);
if (missing.length > 0) {
  console.log(`  absent  : ${missing.join(', ')} (optional; add when the import shows up)`);
}
console.log(`  present : ${readdirSync(join(target, '@deepseek-ai')).join(', ') || '(none)'}`);
