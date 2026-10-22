/**
 * 界面文字检查：中英文词典的占位符是否一致；跑一段英文模拟，看蚂蚁的行为、日志和事件里有没有漏翻的中文或没替换的 {参数}。
 * npx tsx scripts/i18ncheck.ts [模拟秒数，默认 600]
 */
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';
import { setLang, t, tr, type MsgKey } from '../src/i18n';
import { World } from '../src/world/world';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const problems: string[] = [];
for (const k of Object.keys(zh) as MsgKey[]) {
  const a = zh[k];
  const b = en[k];
  if (typeof b === 'string' && holes(a) !== holes(b)) problems.push(`${k}: 中文 {${holes(a)}} 英文 {${holes(b)}}`);
  if (typeof b === 'function') {
    const p = Object.fromEntries(holes(a).split(',').filter(Boolean).map((n) => [n, n === 'n' ? 2 : 'x']));
    const s = b(p);
    if (/undefined|\{\w+\}/.test(s)) problems.push(`${k}: 英文函数输出 "${s}"`);
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
for (const e of w.colony.events) texts.push(tr(e.msg));
for (const c of w.nest.chambers) texts.push(tr(c.label));
texts.push(t('ui.temp', { weather: w.weather.label, t: 20, h: 50 }), tr(w.clock.stamp()));
for (const s of texts) {
  if (seen.has(s)) continue;
  seen.add(s);
  if (/[\u4e00-\u9fff]|undefined|\{\w+\}|\[object/.test(s)) problems.push(`模拟文字: "${s}"`);
}
console.log(`词典 ${Object.keys(zh).length} 条，模拟中出现 ${seen.size} 种英文文字`);
console.log(problems.length ? problems.join('\n') : '检查通过');
if (problems.length) process.exitCode = 1;
