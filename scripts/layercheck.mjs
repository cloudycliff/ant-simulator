// 依赖方向检查：src/core 不能导入 src/games 和 src/main.ts；一个游戏不能导入另一个游戏
// 用法：node scripts/layercheck.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * 还没拆开的依赖，格式“导入方 -> 被导入方”（相对 src）。拆掉一项就从这里删掉一项；
 * 列着却已经不存在的项也会报错，免得名单只增不减
 */
const PENDING = [
  'core/i18n/index.ts -> games/ant/i18n/en.ts',
  'core/i18n/index.ts -> games/ant/i18n/zh.ts',
  'core/platform/background.ts -> games/ant/config.ts',
  'core/platform/saveSlot.ts -> games/ant/world/save.ts',
  'core/render/environment.ts -> games/ant/config.ts',
  'core/render/quality.ts -> games/ant/config.ts',
  'core/render/rain.ts -> games/ant/world/weather.ts',
  'core/sim/clock.ts -> games/ant/config.ts',
  'core/sim/spatial.ts -> games/ant/sim/ant.ts',
];

const SRC = resolve('src');
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk(SRC);

const rel = (p) => relative(SRC, p).split('\\').join('/');
const resolveSpec = (from, spec) => {
  const base = resolve(dirname(from), spec);
  return [base, `${base}.ts`, join(base, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile());
};
const area = (r) => (r.startsWith('core/') ? 'core' : r.startsWith('games/') ? r.split('/').slice(0, 2).join('/') : 'app');

const found = new Set();
const bad = [];
for (const f of files) {
  const from = rel(f);
  const a = area(from);
  for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']*)'/g)) {
    const target = resolveSpec(f, m[1]);
    if (!target) continue;
    const to = rel(target);
    const b = area(to);
    const wrong = (a === 'core' && b !== 'core') || (a.startsWith('games/') && b.startsWith('games/') && a !== b);
    if (!wrong) continue;
    const key = `${from} -> ${to}`;
    found.add(key);
    if (!PENDING.includes(key)) bad.push(key);
  }
}
const stale = PENDING.filter((k) => !found.has(k));
for (const k of bad) console.log(`不允许的依赖：${k}`);
for (const k of stale) console.log(`已经拆掉，请从 PENDING 里删除：${k}`);
console.log(`待拆的依赖还有 ${found.size - bad.length} 项`);
process.exit(bad.length || stale.length ? 1 : 0);
