/**
 * 界面文字检查：中英文词典的占位符是否一致；框架代码只用框架词典的键，游戏改写框架文字不改占位符；跑一段英文模拟，看蚂蚁的行为、日志和事件里有没有漏翻的中文或没替换的 {参数}。
 * 一个进程只能登记一个游戏的词典，鱼缸和蜜蜂的英文模拟文字在 aquatest、beetest 里查。
 * npx tsx scripts/i18ncheck.ts [模拟秒数，默认 600]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coreEn } from '../src/core/i18n/en';
import { coreZh } from '../src/core/i18n/zh';
import { en } from '../src/games/ant/i18n/en';
import { overrides } from '../src/games/ant/i18n/overrides';
import { zh } from '../src/games/ant/i18n/zh';
import { en as aqEn } from '../src/games/aquarium/i18n/en';
import { overrides as aqOverrides } from '../src/games/aquarium/i18n/overrides';
import { zh as aqZh } from '../src/games/aquarium/i18n/zh';
import { en as beeEn } from '../src/games/bee/i18n/en';
import { overrides as beeOverrides } from '../src/games/bee/i18n/overrides';
import { zh as beeZh } from '../src/games/bee/i18n/zh';
import { setLang, t, tr, type Entry } from '../src/core/i18n';
import { World } from '../src/games/ant/world/world';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const problems: string[] = [];
let keys = 0;
const pairs: [Record<string, Entry>, Record<string, Entry>][] = [
  [coreZh, coreEn],
  [zh, en],
  [aqZh, aqEn],
  [beeZh, beeEn],
];
for (const [zd, ed] of pairs) {
  for (const k of Object.keys(zd)) {
    keys++;
    const a = zd[k];
    const b = ed[k];
    if (typeof a !== 'string') continue;
    if (typeof b === 'string' && holes(a) !== holes(b)) problems.push(`${k}: 中文 {${holes(a)}} 英文 {${holes(b)}}`);
    if (typeof b === 'function') {
      const p = Object.fromEntries(holes(a).split(',').filter(Boolean).map((n) => [n, n === 'n' ? 2 : 'x']));
      const s = b(p);
      if (/undefined|\{\w+\}/.test(s)) problems.push(`${k}: 英文函数输出 "${s}"`);
    }
  }
}

// 游戏的键和框架重名时登记会报错，要改写框架文字得走 overrides
for (const [name, d] of [['蚂蚁', zh], ['鱼缸', aqZh], ['蜜蜂', beeZh]] as const) {
  for (const k of Object.keys(d)) if (k in coreZh) problems.push(`${name}词典和框架重名: ${k}`);
}

// 游戏改写框架文字时占位符不能变，框架传的参数才对得上
for (const [lang, d] of [...Object.entries(overrides), ...Object.entries(aqOverrides), ...Object.entries(beeOverrides)]) {
  for (const [k, v] of Object.entries(d)) {
    const base = coreZh[k as keyof typeof coreZh];
    if (typeof v === 'string' && typeof base === 'string' && holes(v) !== holes(base)) problems.push(`改写 ${lang} ${k}: {${holes(v)}}，框架是 {${holes(base)}}`);
  }
}

// 框架代码只能用框架词典里的键：游戏专属的键换个游戏就没有了
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
for (const f of walk('src/core')) {
  if (f.includes(join('core', 'i18n'))) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/'([a-z]+\.[A-Za-z][\w.]*)'/g)) {
    if ((m[1] in zh || m[1] in aqZh || m[1] in beeZh) && !(m[1] in coreZh)) problems.push(`${f}: 用了游戏词典的键 ${m[1]}`);
  }
  for (const m of src.matchAll(/\b(?:t|L)\(\s*'([\w.]+)'/g)) {
    if (!(m[1] in coreZh)) problems.push(`${f}: 框架词典里没有 ${m[1]}`);
  }
}

setLang('en');
const w = new World();
const secs = Number(process.argv[2] ?? 600);
for (let s = 0; s < secs; s += 1 / 30) w.advance(1 / 30);
w.callRain();
for (let s = 0; s < 60; s += 1 / 30) w.advance(1 / 30);
const seen = new Set<string>();
const texts: string[] = [];
for (const a of w.colony.ants) {
  texts.push(tr(a.activity), tr(a.locationLabel(w)));
  for (const l of a.log) texts.push(tr(l.msg));
}
for (const e of w.events.entries) texts.push(tr(e.msg));
for (const c of w.nest.chambers) texts.push(tr(c.label));
texts.push(t('ui.temp', { weather: w.weather.label, t: 20, h: 50 }), tr(w.clock.stamp()));
for (const s of texts) {
  if (seen.has(s)) continue;
  seen.add(s);
  if (/[\u4e00-\u9fff]|undefined|\{\w+\}|\[object/.test(s)) problems.push(`模拟文字: "${s}"`);
}
console.log(`词典 ${keys} 条，模拟中出现 ${seen.size} 种英文文字`);
console.log(problems.length ? problems.join('\n') : '检查通过');
if (problems.length) process.exitCode = 1;
