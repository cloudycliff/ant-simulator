/**
 * 鱼缸示例的无界面检查：鱼不出缸、喂食后会吃、开关灯和吃完的事件、存档往返、同编号可重现、英文文字没漏翻。
 * npx tsx scripts/aquatest.ts
 */
import { setLang, tr } from '../src/core/i18n';
import { CONFIG } from '../src/games/aquarium/config';
import { Tank, aqSave, type AqSaveData } from '../src/games/aquarium/tank';

setLang('en');
const STEP = 1 / 30;
const T = CONFIG.tank;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '通过' : '失败'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};
const run = (w: Tank, secs: number) => {
  for (let s = 0; s < secs; s += STEP) w.advance(STEP);
};
const avgHunger = (w: Tank) => w.fish.reduce((s, f) => s + f.hunger, 0) / w.fish.length;
const inside = (w: Tank) =>
  w.fish.every((f) => Number.isFinite(f.pos.x + f.pos.y + f.pos.z) && Math.abs(f.pos.x) <= T.w / 2 && Math.abs(f.pos.z) <= T.d / 2 && f.pos.y >= w.floorAt(f.pos.x, f.pos.z) && f.pos.y < T.water);
const fingerprint = (w: Tank) => w.fish.map((f) => `${f.pos.x.toFixed(3)},${f.pos.y.toFixed(3)},${f.pos.z.toFixed(3)}`).join(';') + `|${w.food.length}`;
const msgs = (w: Tank) => w.events.entries.map((e) => e.msg.k);

const t0 = performance.now();
const w = new Tank(7);
run(w, 60);
check('一分钟后鱼都在缸里', inside(w));

const unfed = new Tank(7);
run(unfed, 60);
const fed = w.feed(0, 0, 24, 7, false);
check('喂食成功并记事件', fed.ok && msgs(w).includes('ev.fed'));
check('缸外不能喂', !w.feed(T.w, 0, 8, 3, true).ok);
run(w, 120);
run(unfed, 120);
check('喂食两分钟内吃掉了鱼食', w.stats.eaten > 0, `吃掉 ${w.stats.eaten} 片，剩 ${w.food.length} 片`);
check('比不喂的鱼缸饿得轻', avgHunger(w) < avgHunger(unfed) - 0.05, `${avgHunger(unfed).toFixed(3)} → ${avgHunger(w).toFixed(3)}`);
run(w, CONFIG.food.rotSec + 60);
check('鱼食吃完或烂掉', w.food.length === 0 || w.stats.rotted > 0, `剩 ${w.food.length} 片，烂掉 ${w.stats.rotted}`);
check('吃完或烂掉有事件', msgs(w).includes('ev.allEaten') || msgs(w).includes('ev.rotted'));

const near = w.fish[0].pos.clone();
const tapped = w.tap(near, false);
check('敲玻璃附近的鱼受惊', tapped.ok && w.fish.some((f) => f.fleeT > 0));

run(w, CONFIG.clock.dayLength);
check('一天里有开灯和关灯事件', msgs(w).includes('ev.lightOn') && msgs(w).includes('ev.lightOff'));
check('一天后鱼还在缸里', inside(w));
check('每小时一个统计点', w.history.length >= 23, `${w.history.length} 个`);
const simSecs = 2 * (60 + 120) + CONFIG.food.rotSec + 60 + CONFIG.clock.dayLength;
const ms = performance.now() - t0;

const json = JSON.stringify(aqSave.write(w, 1));
const load = () => {
  const d = JSON.parse(json) as AqSaveData;
  const x = new Tank(d.seed);
  aqSave.read(x, d);
  return x;
};
const a = load();
check('存档往返内容一致', JSON.stringify(aqSave.write(a, 1)) === json, `${(json.length / 1024).toFixed(1)} KB`);
const b = load();
run(a, 60);
run(b, 60);
check('同一存档读两次走得一样', fingerprint(a) === fingerprint(b));
let bad: string | null = null;
try {
  aqSave.read(new Tank(8), JSON.parse(json) as AqSaveData);
} catch (e) {
  bad = (e as Error).message;
}
check('编号不对的存档拒读', bad !== null, bad ?? '');
check('旧版本存档报问题', aqSave.problem({ ...(JSON.parse(json) as AqSaveData), version: 0 }) !== null);

const c = new Tank(7);
const d = new Tank(7);
for (const x of [c, d]) {
  run(x, 30);
  x.feed(10, 5, 8, 3, false);
  run(x, 90);
}
check('同编号同操作结果相同', fingerprint(c) === fingerprint(d));

const texts = new Set<string>();
for (const f of w.fish) texts.add(tr(f.activity));
for (const e of w.events.entries) texts.add(tr(e.msg));
texts.add(tr(fed.msg!)).add(tr(tapped.msg!));
const leaks = [...texts].filter((s) => /[\u4e00-\u9fff]|undefined|\{\w+\}|\[object/.test(s));
check('英文文字没漏翻', leaks.length === 0, leaks.join(' / ') || `${texts.size} 种`);

console.log(`${w.fish.length} 条鱼，模拟 ${simSecs} 秒用了 ${ms.toFixed(0)} ms（${((ms / simSecs) * 1000).toFixed(1)} ms/模拟千秒）`);
if (failed) {
  console.log(`${failed} 项失败`);
  process.exitCode = 1;
} else console.log('全部通过');
