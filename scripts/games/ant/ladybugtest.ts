/**
 * 瓢虫测试：自然运行几天，看瓢虫来访、蚜虫数量涨落（太挤时迁飞）；再往一群有蚂蚁照料、一群没人照料的蚜虫上各放一只瓢虫，比较吃掉多少。
 * npx tsx scripts/games/ant/ladybugtest.ts [自然运行秒数，默认 4200] [对照观察秒数，默认 300]
 */
import { tr } from '../../../src/core/i18n';
import { CONFIG } from '../../../src/games/ant/config';
import type { AphidColony } from '../../../src/games/ant/world/aphids';
import { World } from '../../../src/games/ant/world/world';

const secs = Number(process.argv[2] ?? 4200);
const watch = Number(process.argv[3] ?? 300);
const w = new World();
const step = 1 / 30;
CONFIG.weather.rainPerDay = 0;
const log: string[] = [];
const push = w.events.push.bind(w.events);
w.events.push = (...args) => {
  if (/adybug|aphids/.test(String(args[0].k))) log.push(`${tr(w.clock.stamp())} ${tr(args[0])}`);
  push(...args);
};

const A = w.aphids.colonies;
const start = A.map((c) => c.count);
const hi = [...start];
/** 从此前最高点回落的最大只数 */
const drop = A.map(() => 0);
const tendedSec = A.map(() => 0);
for (let t = 0; t < secs; t += step) {
  w.advance(step);
  A.forEach((c, i) => {
    hi[i] = Math.max(hi[i], c.count);
    drop[i] = Math.max(drop[i], hi[i] - c.count);
    if (c.tended(w.clock.seconds)) tendedSec[i] += step;
  });
}
const L = w.ladybugs;
console.log(`自然运行 ${secs} 秒（${(secs / CONFIG.time.dayLength).toFixed(1)} 天）：瓢虫来了 ${L.visits} 次，被蚂蚁赶走 ${L.repelled} 次，吃掉 ${L.eaten} 只蚜虫`);
A.forEach((c, i) => {
  console.log(
    `  蚜虫群 ${i}（${tr(w.describePlace(c.x, c.z))}）：${start[i]} → ${c.count.toFixed(0)}，最多 ${hi[i].toFixed(0)}，最多回落 ${drop[i].toFixed(0)}，` +
      `被照料 ${((tendedSec[i] / secs) * 100).toFixed(0)}% 的时间，被瓢虫吃掉 ${c.eaten}`,
  );
});
console.log('瓢虫事件：');
for (const e of log) console.log(' ', e);

/** 往一群蚜虫上放一只胃口不限的瓢虫，观察 watch 秒 */
function trial(name: string, wd: World, c: AphidColony): { eaten: number; fled: boolean } {
  const r = wd.placeLadybug(c.x, c.z);
  if (!r.ok) {
    problems.push(`${name}放不下瓢虫：${tr(r.msg!)}`);
    return { eaten: 0, fled: false };
  }
  const l = wd.ladybugs.on(c)!;
  l.appetite = 1000;
  const before = c.eaten;
  let gone = -1;
  let tendedFor = 0;
  for (let t = 0; t < watch && gone < 0; t += step) {
    wd.advance(step);
    if (c.tended(wd.clock.seconds)) tendedFor += step;
    if (l.state === 'leave') gone = t;
  }
  const how = gone < 0 ? `${watch} 秒后还在吃` : `${gone.toFixed(0)} 秒后${l.fled ? '被赶走' : '自己飞走'}`;
  console.log(`对照 ${name}（${tr(wd.describePlace(c.x, c.z))}，剩 ${c.count.toFixed(0)} 只，期间被照料 ${tendedFor.toFixed(0)} 秒）：吃掉 ${c.eaten - before} 只，${how}`);
  return { eaten: c.eaten - before, fled: l.fled };
}

const problems: string[] = [];
// 有照料：五天后照料最多的一群；没照料：开局时离巢最远、蚂蚁还没找到的一群
for (const l of [...L.ladybugs]) L.shoo(l, false);
for (let t = 0; t < 4; t += step) w.advance(step);
const best = A.map((_, i) => i).sort((a, b) => tendedSec[b] - tendedSec[a])[0];
const tended = trial('有照料', w, A[best]);
const fresh = new World();
const far = [...fresh.aphids.colonies].sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z))[0];
const wild = trial('没照料', fresh, far);
if (!tended.fled) problems.push('有照料的那群没把瓢虫赶走');
if (tended.eaten * 2 > wild.eaten) problems.push('有照料的那群被吃得不比没照料的少一半');
if (wild.eaten < 20) problems.push('没照料的那群几乎没被吃');
if (L.visits < 2) problems.push(`${secs} 秒里瓢虫只来了 ${L.visits} 次`);
if (!drop.some((d) => d >= 15)) problems.push('蚜虫数量只涨不落');
console.log(problems.length ? `失败：${problems.join('；')}` : `全部通过：瓢虫来了 ${L.visits} 次，赶走 ${L.repelled} 次`);
if (problems.length) process.exitCode = 1;
